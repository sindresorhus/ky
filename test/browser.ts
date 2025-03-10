import test, {type ExecutionContext} from 'ava';
import busboy from 'busboy';
import express from 'express';
import {chromium, webkit, type Page} from 'playwright';
import type ky from '../source/index.js'; // eslint-disable-line import/no-duplicates
import type {Progress} from '../source/index.js'; // eslint-disable-line import/no-duplicates
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
	await page.waitForFunction(() => typeof window.ky === 'function');
};

let server: ExtendedHttpTestServer;
test.beforeEach(async () => {
	server = await createEsmTestServer();
});

test.afterEach(async () => {
	await server.close();
});

defaultBrowsersTest('prefixUrl option', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end('zebra');
	});

	server.get('/api/unicorn', (_request, response) => {
		response.end('rainbow');
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	await t.throwsAsync(
		page.evaluate(async () => window.ky('/foo', {prefixUrl: '/'})),
		{message: /`input` must not begin with a slash when using `prefixUrl`/},
	);

	const results = await page.evaluate(async (url: string) => Promise.all([
		window.ky(`${url}/api/unicorn`).text(),
		// @ts-expect-error unsupported {prefixUrl: null} type
		window.ky(`${url}/api/unicorn`, {prefixUrl: null}).text(),
		window.ky('api/unicorn', {prefixUrl: url}).text(),
		window.ky('api/unicorn', {prefixUrl: `${url}/`}).text(),
	]), server.url);

	t.deepEqual(results, ['rainbow', 'rainbow', 'rainbow', 'rainbow']);
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
		const request = window.ky(`${url}/test`, {signal: controller.signal}).text();
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
		const request = window.ky.get(`${url}/test`, {onDownloadProgress() {}}).then(async v => ({
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

defaultBrowsersTest('should not copy response body with 204 status code when using `onDownloadProgress` ', async (t: ExecutionContext, page: Page) => {
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
		const progress: any = [];
		let totalBytes = 0;
		const response = await window.ky.get(`${url}/test`, {
			onDownloadProgress(progressEvent) {
				progress.push(progressEvent);
			},
		}).then(async v => {
			totalBytes = Number(v.headers.get('content-length')) || 0;
			return ({
				headers: v.headers.get('X-ky-Header'),
				status: v.status,
				statusText: v.statusText,
			});
		});
		return {
			response,
			progress,
			totalBytes,
		};
	}, server.url);

	t.deepEqual(data.response, {
		status,
		headers: 'ky',
		statusText,
	});
	t.deepEqual(data.progress, [{
		percent: 1,
		totalBytes: data.totalBytes,
		transferredBytes: 0,
	}]);
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
		const request = window.ky(`${url}/test`, {signal: controller.signal, onDownloadProgress() {}}).text();
		setTimeout(() => {
			controller.abort();
		}, 500);
		return request.catch(error_ => error_.toString());
	}, server.url);
	// This should be an AbortError like in the 'aborting a request' test, but there is a bug in Chromium
	t.is(error, 'TypeError: Failed to fetch');
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
			const request = window.ky(`${url}/slow`, {timeout: 500}).text();
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
		const text = await window
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
		[{percent: 0, transferredBytes: 0, totalBytes: 4}, ''],
		[{percent: 0.5, transferredBytes: 2, totalBytes: 4}, 'me'],
		[{percent: 1, transferredBytes: 4, totalBytes: 4}, 'ow'],
	]);
	t.is(result.text, 'meow');
});

defaultBrowsersTest('throws if onDownloadProgress is not a function', async (t: ExecutionContext, page: Page) => {
	server.get('/', (_request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const error = await page.evaluate(async (url: string) => {
		// @ts-expect-error
		const request = window.ky(url, {onDownloadProgress: 1}).text();
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
		const request = window.ky(url, {onDownloadProgress() {}}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'Error: Streams are not supported in your environment. `ReadableStream` is missing.');
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
		const formData = new window.FormData();
		formData.append('file', new window.File(['bubblegum pie'], 'my-file'));
		return window.ky(url, {
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
		const formData = new window.FormData();

		formData.append('file', new window.File(['bubblegum pie'], 'my-file', {type: 'text/plain'}));

		return window.ky(url, {
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
			const request = new window.Request(`${url}/test`, {
				headers: {'content-type': 'text/css'},
			});

			return window
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
		page.evaluate(async (url: string) => window.ky(`${url}/test`, {
			body: 'foo',
			method: 'PUT',
			retry: 1,
		}), server.url),
		{message: /HTTPError: Request failed with status code 502 Bad Gateway: PUT/},
	);

	t.is(requestCount, 2);
});
