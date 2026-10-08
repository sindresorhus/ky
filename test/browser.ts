import test, {type ExecutionContext} from 'ava';
import busboy from 'busboy';
import express from 'express';
import {
	chromium,
	webkit,
	type Page,
} from 'playwright';
import type ky from '../source/index.js';
import type {Progress} from '../source/index.js';
import {createHttpTestServer, type ExtendedHttpTestServer, type HttpServerOptions} from './helpers/create-http-test-server.js';
import {parseRawBody} from './helpers/parse-body.js';
import {browserTest, defaultBrowsersTest} from './helpers/with-page.js';

declare global {
	// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
	interface Window {
		ky: typeof ky;
	}
}

const DIST_DIR = new URL('../distribution', import.meta.url).toString();
const createEsmTestServer = async (options?: HttpServerOptions) => {
	const server = await createHttpTestServer(options);
	server.use('/distribution', express.static(DIST_DIR.replace(/^file:\/\//, '')));
	server.use((_, response, next) => {
		response.set('Connection', 'close');
		next();
	});
	return server;
};

const KY_SCRIPT = {
	type: 'module',
	content: `
		import ky from '/distribution/index.js';
		globalThis.ky = ky;
	`,
};
const addKyScriptToPage = async (page: Page) => {
	await page.addScriptTag(KY_SCRIPT);
	await page.waitForFunction(() => typeof globalThis.ky === 'function');
};

let server: ExtendedHttpTestServer;
test.beforeEach(async () => {
	server = await createEsmTestServer();
});

test.afterEach(async () => {
	await server.close();
});

defaultBrowsersTest('maxResponseSize limits response bytes', async (t, page) => {
	server.get('/', (_request, response) => {
		response.end('🦄');
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const result = await page.evaluate(async (url: string) => {
		const text = await globalThis.ky(url, {maxResponseSize: 4}).text();
		let errorName: string | undefined;
		let hookErrorName: string | undefined;
		try {
			await globalThis.ky(url, {
				maxResponseSize: 3,
				hooks: {
					afterResponse: [async ({response}) => {
						await response.text();
					}],
					beforeError: [({error}) => {
						hookErrorName = error.name;
						return error;
					}],
				},
			});
		} catch (error) {
			errorName = (error as Error).name;
		}

		return {text, errorName, hookErrorName};
	}, server.url);

	t.deepEqual(result, {text: '🦄', errorName: 'ResponseSizeError', hookErrorName: 'ResponseSizeError'});
});

defaultBrowsersTest('maxResponseSize passes through a 204 response', async (t, page) => {
	server.get('/', (_request, response) => {
		response.end('meow');
	});

	server.get('/empty', (_request, response) => {
		response.status(204).header('X-ky-Header', 'ky').end();
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	// Chromium exposes a body stream on 204 responses even though the `Response` constructor rejects a body for that status.
	const result = await page.evaluate(async (url: string) => {
		const response = await globalThis.ky(`${url}/empty`, {maxResponseSize: 1024});
		return {
			status: response.status,
			header: response.headers.get('X-ky-Header'),
			text: await response.text(),
		};
	}, server.url);

	t.deepEqual(result, {status: 204, header: 'ky', text: ''});
});

// WebKit exposes a body for `205 Reset Content`, which the Fetch spec lists as a null body status. Ky cannot wrap such a response, because the `Response` constructor rejects a body for those statuses, so `maxResponseSize` and `onDownloadProgress` do not apply to it.
browserTest('maxResponseSize does not apply to a 205 response body in WebKit', [webkit], async (t, page) => {
	server.get('/', (_request, response) => {
		response.end('ok');
	});

	server.get('/reset', (_request, response) => {
		response.writeHead(205, {'content-type': 'text/plain', 'content-length': '4'});
		response.end('abcd');
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const result = await page.evaluate(async (url: string) => {
		let progressCalls = 0;
		const response = await globalThis.ky(url, {
			maxResponseSize: 1,
			retry: 0,
			onDownloadProgress() {
				progressCalls++;
			},
		});

		return {status: response.status, text: await response.text(), progressCalls};
	}, `${server.url}/reset`);

	t.deepEqual(result, {status: 205, text: 'abcd', progressCalls: 0});
});

defaultBrowsersTest('maxResponseSize preserves errors in native body methods and progress wrappers', async (t, page) => {
	server.get('/', (_request, response) => {
		response.end('ok');
	});
	server.get('/data', (_request, response) => {
		response.set('content-type', 'application/x-www-form-urlencoded').end('a=1');
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const errors = await page.evaluate(async (url: string) => {
		const errors: Array<string | undefined> = [];
		for (const method of ['text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes'] as const) {
			if (typeof Response.prototype[method] !== 'function') {
				continue;
			}

			// eslint-disable-next-line no-await-in-loop
			const response = await globalThis.ky(`${url}/data`, {
				maxResponseSize: 1,
				hooks: {
					afterResponse: [({response}) => {
						// Exercise both branches of a native clone before wrapping the shared body.
						void response.clone().body?.cancel();
						return new Response(response.body, response);
					}],
				},
				onDownloadProgress() {
					return undefined;
				},
			});

			for (const body of [response.clone(), response]) {
				let errorName: string | undefined;
				try {
					// eslint-disable-next-line no-await-in-loop
					await body[method]();
				} catch (error) {
					errorName = (error as Error).name;
				}

				errors.push(errorName);
			}
		}

		return errors;
	}, server.url);

	t.true(errors.length >= 10);
	t.true(errors.every(name => name === 'ResponseSizeError'));
});

defaultBrowsersTest('baseUrl option', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end('zebra');
	});

	server.get('/unicorn', (_request, response) => {
		response.end('charlie');
	});

	server.get('/api/unicorn', (_request, response) => {
		response.end('rainbow');
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const results = await page.evaluate(async (url: string) => Promise.all([
		globalThis.ky(`${url}/api/unicorn`).text(),
		globalThis.ky(`${url}/api/unicorn`, {baseUrl: undefined}).text(),
		globalThis.ky('api/unicorn', {baseUrl: url}).text(),
		globalThis.ky('unicorn', {baseUrl: `${url}/api`}).text(),
		globalThis.ky('/unicorn', {baseUrl: `${url}/api`}).text(),
		globalThis.ky('unicorn', {baseUrl: `${url}/api/`}).text(),
		globalThis.ky('/unicorn', {baseUrl: `${url}/api/`}).text(),
	]), server.url);

	t.deepEqual(results, ['rainbow', 'rainbow', 'rainbow', 'charlie', 'charlie', 'rainbow', 'charlie']);
});

defaultBrowsersTest('prefix option', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end('zebra');
	});

	server.get('/api/unicorn', (_request, response) => {
		response.end('rainbow');
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const results = await page.evaluate(async (url: string) => Promise.all([
		globalThis.ky(`${url}/api/unicorn`).text(),
		globalThis.ky(`${url}/api/unicorn`, {prefix: undefined}).text(),
		globalThis.ky('api/unicorn', {prefix: url}).text(),
		globalThis.ky('unicorn', {prefix: `${url}/api`}).text(),
		globalThis.ky('/unicorn', {prefix: `${url}/api`}).text(),
		globalThis.ky('unicorn', {prefix: `${url}/api/`}).text(),
		globalThis.ky('/unicorn', {prefix: `${url}/api/`}).text(),
	]), server.url);

	t.deepEqual(results, ['rainbow', 'rainbow', 'rainbow', 'rainbow', 'rainbow', 'rainbow', 'rainbow']);
});

defaultBrowsersTest('QUERY request', async (t: ExecutionContext, page: Page) => {
	t.plan(2);

	server.get('/', (_request, response) => {
		response.end();
	});

	server.all('/test', (request, response) => {
		t.is(request.method, 'QUERY');
		response.json(request.body);
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const json = {
		foo: true,
	};

	const result = await page.evaluate(async ({url, json}) => globalThis.ky.query(`${url}/test`, {json}).json(), {
		url: server.url,
		json,
	});

	t.deepEqual(result, json);
});

defaultBrowsersTest('aborting a request', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end('meow');
	});

	server.get('/test', (_request, response) => {
		setTimeout(() => {
			response.end('ok');
		}, 500);
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const errorName = await page.evaluate(async (url: string) => {
		const controller = new AbortController();
		const request = globalThis.ky(`${url}/test`, {signal: controller.signal}).text();
		controller.abort();
		return request.catch(error_ => error_.name);
	}, server.url);

	t.is(errorName, 'AbortError');
});

defaultBrowsersTest('should copy origin response info when using `onDownloadProgress`', async (t: ExecutionContext, page: Page) => {
	const json = {hello: 'world'};
	const status = 202;
	const statusText = 'Accepted';
	server.get('/', (_request, response) => {
		response.end('meow');
	});

	server.get('/test', (_request, response) => {
		setTimeout(() => {
			response.statusMessage = statusText;
			response.status(status).header('X-ky-Header', 'ky').json(json);
		}, 500);
	});
	await page.goto(server.url);
	await addKyScriptToPage(page);
	const data = await page.evaluate(async (url: string) => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const request = globalThis.ky.get(`${url}/test`, {onDownloadProgress() {}}).then(async v => ({
			headers: v.headers.get('X-ky-Header'),
			status: v.status,
			statusText: v.statusText,
			data: await v.json(),
		}));
		return request;
	}, server.url);

	t.deepEqual(data, {
		status,
		headers: 'ky',
		statusText,
		data: json,
	});
});

defaultBrowsersTest('should not copy response body with 204 status code when using `onDownloadProgress`', async (t: ExecutionContext, page: Page) => {
	const status = 204;
	const statusText = 'No content';
	server.get('/', (_request, response) => {
		response.end('meow');
	});

	server.get('/test', (_request, response) => {
		setTimeout(() => {
			response.statusMessage = statusText;
			response.status(status).header('X-ky-Header', 'ky').end(null);
		}, 500);
	});
	await page.goto(server.url);
	await addKyScriptToPage(page);
	const data = await page.evaluate(async (url: string) => {
		const progress: Progress[] = [];
		const response = await globalThis.ky.get(`${url}/test`, {
			onDownloadProgress(progressEvent) {
				progress.push(progressEvent);
			},
		});
		return {
			response: {
				headers: response.headers.get('X-ky-Header'),
				status: response.status,
				statusText: response.statusText,
				text: await response.text(),
			},
			progress,
		};
	}, server.url);

	t.deepEqual(data.response, {
		status,
		headers: 'ky',
		statusText,
		text: '',
	});
	t.deepEqual(data.progress, []);
});

browserTest('aborting a request with onDownloadProgress', [chromium], async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end('meow');
	});

	server.get('/test', (_request, response) => {
		response.writeHead(200, {
			'content-length': '4',
		});

		response.write('me');
		setTimeout(() => {
			response.end('ow');
		}, 1000);
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const error = await page.evaluate(async (url: string) => {
		const controller = new AbortController();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const request = globalThis.ky(`${url}/test`, {signal: controller.signal, onDownloadProgress() {}}).text();
		setTimeout(() => {
			controller.abort();
		}, 500);
		return request.catch(error_ => error_.name);
	}, server.url);
	// Chromium reports this abort as `TypeError: Failed to fetch`, which Ky replaces with the abort reason.
	t.is(error, 'AbortError');
});

defaultBrowsersTest(
	'throws TimeoutError even though it does not support AbortController',
	async (t: ExecutionContext, page: Page) => {
		server.get('/', (_request, response) => {
			response.end();
		});

		server.get('/slow', (_request, response) => {
			setTimeout(() => {
				response.end('ok');
			}, 1000);
		});

		await page.goto(server.url);
		await page.addScriptTag({content: 'window.AbortController = undefined;\n'});
		await addKyScriptToPage(page);

		const error = await page.evaluate(async (url: string) => {
			const request = globalThis.ky(`${url}/slow`, {timeout: 500}).text();
			return request.catch(error_ => ({
				message: error_.toString(),
				request: {url: error_.request.url},
			}));
		}, server.url);

		if (typeof error !== 'object') {
			throw new TypeError('Expected to have an object error');
		}

		t.is(error.message, `TimeoutError: Request timed out: GET ${server.url}/slow`);
		t.is(error.request.url, `${server.url}/slow`);
	},
);

browserTest('onDownloadProgress works', [chromium, webkit], async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.writeHead(200, {
			'content-length': '4',
		});

		response.write('me');
		setTimeout(() => {
			response.end('ow');
		}, 1000);
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const result = await page.evaluate(async (url: string) => {
		const data: Array<Array<(Progress | string)>> = [];
		const text = await globalThis
			.ky(url, {
				onDownloadProgress(progress, chunk) {
					// Decode Utf8
					const stringifiedChunk = String.fromCodePoint(...chunk);
					data.push([progress, stringifiedChunk]);
				},
			})
			.text();

		return {data, text};
	}, server.url);

	t.deepEqual(result.data, [
		[{percent: 0.5, transferredBytes: 2, totalBytes: 4}, 'me'],
		[{percent: 1, transferredBytes: 4, totalBytes: 4}, 'ow'],
	]);
	t.is(result.text, 'meow');
});

defaultBrowsersTest('onDownloadProgress completes for an empty response body', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end('meow');
	});

	server.get('/test', (_request, response) => {
		response.header('content-length', '0').end();
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const result = await page.evaluate(async (url: string) => {
		const progressEvents: Array<{progress: Progress; chunkLength: number}> = [];
		const text = await globalThis.ky(`${url}/test`, {
			onDownloadProgress(progress, chunk) {
				progressEvents.push({progress, chunkLength: chunk.byteLength});
			},
		}).text();

		return {progressEvents, text};
	}, server.url);

	t.is(result.text, '');
	t.deepEqual(result.progressEvents, [{
		progress: {percent: 1, totalBytes: 0, transferredBytes: 0},
		chunkLength: 0,
	}]);
});

defaultBrowsersTest('throws if onDownloadProgress is not a function', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const error = await page.evaluate(async (url: string) => {
		// @ts-expect-error
		const request = globalThis.ky(url, {onDownloadProgress: 1}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'TypeError: The `onDownloadProgress` option must be a function');
});

defaultBrowsersTest('throws if does not support ReadableStream', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({content: 'window.ReadableStream = undefined;\n'});
	await addKyScriptToPage(page);

	const error = await page.evaluate(async (url: string) => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const request = globalThis.ky(url, {onDownloadProgress() {}}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'Error: Streams are not supported in your environment. `ReadableStream` is missing.');
});

defaultBrowsersTest('onUploadProgress is silently ignored when request streams are unsupported', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end();
	});

	server.post('/', (request, response) => {
		t.is(request.body, 'hello');
		response.end('ok');
	});

	await page.goto(server.url);
	// Simulate missing stream support instead of relying on a browser version's capabilities.
	await page.addScriptTag({content: 'window.ReadableStream = undefined;\n'});
	await addKyScriptToPage(page);

	const result = await page.evaluate(async (url: string) => {
		let progressCalled = false;

		const text = await globalThis
			.ky(url, {
				method: 'post',
				body: 'hello',
				hooks: {
					beforeRequest: [({request}) => {
						// Accessing the body can turn it into a stream, even when streaming uploads are unsupported.
						Object.defineProperty(request, 'body', {
							configurable: true,
							get() {
								throw new Error('The request body must not be accessed before fetch');
							},
						});
					}],
				},
				async fetch(request, options) {
					Reflect.deleteProperty(request as Request, 'body');
					return globalThis.fetch(request, options);
				},
				onUploadProgress() {
					progressCalled = true;
				},
			})
			.text();

		return {text, progressCalled};
	}, server.url);

	t.is(result.text, 'ok');
	t.false(result.progressCalled);
});

defaultBrowsersTest('FormData with searchParams', async (t: ExecutionContext, page: Page) => {
	t.plan(3);

	server.get('/', (_request, response) => {
		response.end();
	});

	server.post('/', async (request, response) => {
		const requestBody = await parseRawBody(request);
		const contentType = request.headers['content-type'];
		const boundary = contentType!.split('boundary=')[1];

		t.truthy(requestBody.includes(boundary!));
		t.regex(requestBody, /bubblegum pie/);
		t.deepEqual(request.query, {foo: '1'});
		response.end();
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	await page.evaluate(async (url: string) => {
		const formData = new globalThis.FormData();
		formData.append('file', new globalThis.File(['bubblegum pie'], 'my-file'));
		return globalThis.ky(url, {
			method: 'post',
			searchParams: 'foo=1',
			body: formData,
		});
	}, server.url);
});

defaultBrowsersTest('FormData with searchParams ("multipart/form-data" parser)', async (t: ExecutionContext, page: Page) => {
	t.plan(3);

	server.get('/', (_request, response) => {
		response.end();
	});

	server.post('/', async (request, response) => {
		const [body, error] = await new Promise(resolve => {
			// @ts-expect-error
			const busboyInstance = busboy({headers: request.headers});

			busboyInstance.on('error', (error: Error) => {
				resolve([null, error]);
			});

			// eslint-disable-next-line max-params
			busboyInstance.on('file', async (fieldname, file, filename, encoding, mimetype) => {
				let fileContent = '';
				try {
					for await (const chunk of file) {
						fileContent += chunk; // eslint-disable-line @typescript-eslint/restrict-plus-operands
					}

					resolve([{fieldname, filename, fileContent}, undefined]);
				} catch (error_: unknown) {
					resolve([null, error_]);
				}
			});

			busboyInstance.on('finish', () => {
				response.writeHead(303, {Connection: 'close', Location: '/'});
				response.end();
			});

			setTimeout(() => {
				resolve([null, new Error('Timeout')]);
			}, 3000);

			request.pipe(busboyInstance);
		});

		t.falsy(error);
		t.deepEqual(request.query, {foo: '1'});

		t.deepEqual(body, {
			fieldname: 'file',
			filename: {
				filename: 'my-file',
				encoding: '7bit',
				mimeType: 'text/plain',
			},
			fileContent: 'bubblegum pie',
		});
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	await page.evaluate(async url => {
		const formData = new globalThis.FormData();

		formData.append('file', new globalThis.File(['bubblegum pie'], 'my-file', {type: 'text/plain'}));

		return globalThis.ky(url, {
			method: 'post',
			searchParams: 'foo=1',
			body: formData,
		});
	}, server.url);
});

defaultBrowsersTest(
	'headers are preserved when input is a Request and there are searchParams in the options',
	async (t: ExecutionContext, page: Page) => {
		t.plan(2);

		server.get('/', (_request, response) => {
			response.end();
		});

		server.get('/test', (request, response) => {
			t.is(request.headers['content-type'], 'text/css');
			t.deepEqual(request.query, {foo: '1'});
			response.end();
		});

		await page.goto(server.url);
		await addKyScriptToPage(page);

		await page.evaluate(async (url: string) => {
			const request = new globalThis.Request(`${url}/test`, {
				headers: {'content-type': 'text/css'},
			});

			return globalThis
				.ky(request, {
					searchParams: 'foo=1',
				})
				.text();
		}, server.url);
	},
);

browserTest('retry with body', [chromium, webkit], async (t: ExecutionContext, page: Page) => {
	t.plan(4);

	let requestCount = 0;

	server.get('/', (_request, response) => {
		response.end('zebra');
	});

	server.put('/test', async (request, response) => {
		requestCount++;
		t.is(request.body, 'foo');
		response.sendStatus(502);
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	await t.throwsAsync(
		page.evaluate(async (url: string) => globalThis.ky(`${url}/test`, {
			body: 'foo',
			method: 'PUT',
			retry: 1,
		}), server.url),
		{message: /HTTPError: Request failed with status code 502 Bad Gateway: PUT/},
	);

	t.is(requestCount, 2);
});

defaultBrowsersTest('request is cancelled on timeout', async (t: ExecutionContext, page: Page) => {
	let requestAborted = false;

	server.get('/', (_request, response) => {
		response.end('meow');
	});

	server.get('/slow', (request, response) => {
		request.on('aborted', () => {
			requestAborted = true;
		});

		// Never respond to simulate timeout
		setTimeout(() => {
			if (!response.headersSent) {
				response.end('too late');
			}
		}, 2000);
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	await t.throwsAsync(
		page.evaluate(async (url: string) => globalThis.ky(`${url}/slow`, {timeout: 100}).text(), server.url),
		{message: /Request timed out/},
	);

	// Wait a bit to ensure the abort signal was received
	await page.waitForTimeout(200);

	t.true(requestAborted, 'Request should be aborted on timeout');
});

defaultBrowsersTest('an unbound window.fetch works as the fetch option', async (t: ExecutionContext, page: Page) => {
	let requestCount = 0;

	server.get('/', (_request, response) => {
		response.end('zebra');
	});

	server.get('/unicorn', (_request, response) => {
		response.end('rainbow');
	});

	server.get('/flaky', (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.sendStatus(500);
			return;
		}

		response.end('recovered');
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	// `window.fetch` is intentional here since the bug only reproduces with a native fetch that checks its `this` value.
	/* eslint-disable unicorn/prefer-global-this */
	const results = await page.evaluate(async (url: string) => Promise.all([
		globalThis.ky(`${url}/unicorn`, {fetch: window.fetch}).text(),
		globalThis.ky(`${url}/unicorn`, {fetch: window.fetch, timeout: false}).text(),
		globalThis.ky(`${url}/unicorn`, {fetch: globalThis.fetch}).text(),
		globalThis.ky.create({fetch: window.fetch})(`${url}/unicorn`).text(),
		globalThis.ky(`${url}/flaky`, {fetch: window.fetch, retry: {limit: 1, backoffLimit: 0}}).text(),
	]), server.url);
	/* eslint-enable unicorn/prefer-global-this */

	t.deepEqual(results, ['rainbow', 'rainbow', 'rainbow', 'rainbow', 'recovered']);
	t.is(requestCount, 2);
});

browserTest('beforeRetry upload progress override allows HTTP/1.1 fallback', [chromium], async (t, page) => {
	const uploadServer = await createEsmTestServer({bodyParser: false});
	t.teardown(uploadServer.close);
	uploadServer.get('/', (_request, response) => {
		response.end();
	});
	let receivedRequests = 0;
	uploadServer.put('/upload', async (request, response) => {
		receivedRequests++;
		const body = await parseRawBody(request);
		response.json({body, contentType: request.headers['content-type']});
	});
	await page.goto(uploadServer.url);
	await addKyScriptToPage(page);

	const results = await page.evaluate(async (url: string) => {
		const formData = new FormData();
		formData.append('field', 'payload');
		const bodies = ['payload', new Blob(['payload']), formData, new URLSearchParams({field: 'payload'})];
		const results = [];
		for (const body of bodies) {
			let retryCount = 0;
			let errorName = '';
			let retryContentType: string | undefined;
			// eslint-disable-next-line no-await-in-loop
			const response = await globalThis.ky.put(`${url}/upload`, {
				body,
				onUploadProgress() {
					// Only enables the streamed upload, which fails over HTTP/1.1 in Chromium.
				},
				retry: {
					limit: 1,
					// A method, because tsx wraps an arrow function assigned to a property with a `__name` helper that does not exist in the page.
					delay() {
						return 0;
					},
				},
				hooks: {
					beforeRetry: [state => {
						retryCount = state.retryCount;
						errorName = state.error.name;
						retryContentType = state.request.headers.get('content-type') ?? undefined;
						return {options: {onUploadProgress: undefined}};
					}],
				},
			}).json<{body: string; contentType?: string}>();
			results.push({
				...response,
				retryCount,
				errorName,
				retryContentType,
			});
		}

		return results;
	}, uploadServer.url);

	t.is(receivedRequests, 4);
	for (const result of results) {
		t.is(result.retryCount, 1);
		t.is(result.errorName, 'NetworkError');
		t.is(result.contentType, result.retryContentType);
	}

	t.is(results[0]!.body, 'payload');
	t.is(results[1]!.body, 'payload');
	// The multipart boundary in the retried body must match its content type.
	const boundary = results[2]!.contentType!.split('boundary=')[1]!;
	t.true(results[2]!.body.startsWith(`--${boundary}\r\n`));
	t.true(results[2]!.body.includes('name="field"\r\n\r\npayload\r\n'));
	t.is(results[3]!.body, 'field=payload');
});
