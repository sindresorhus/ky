import test, {ExecutionContext} from 'ava';
import Busboy from 'busboy';
import express from 'express';
import {Page} from 'playwright-chromium';
import ky from '../source/index.js';
import {createHttpTestServer, HttpServerOptions} from './helpers/create-http-test-server.js';
import {parseRawBody} from './helpers/parse-body.js';
import {withPage} from './helpers/with-page.js';

declare global {
	interface Window {
		ky: typeof ky;
	}
}

const DIST_DIR = new URL('../distribution', import.meta.url).toString();
const createEsmTestServer = async (options?: HttpServerOptions) => {
	const server = await createHttpTestServer(options);
	server.use('/distribution', express.static(DIST_DIR.replace(/^file:\/\//, '')));
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

test('prefixUrl option', withPage, async (t: ExecutionContext, page: Page) => {
	const server = await createEsmTestServer();

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

	const results = await page.evaluate(async url => Promise.all([
		window.ky(`${url}/api/unicorn`).text(),
		// @ts-expect-error unsupported {prefixUrl: null} type
		window.ky(`${url}/api/unicorn`, {prefixUrl: null}).text(),
		window.ky('api/unicorn', {prefixUrl: url}).text(),
		window.ky('api/unicorn', {prefixUrl: `${url}/`}).text(),
	]), server.url);

	t.deepEqual(results, ['rainbow', 'rainbow', 'rainbow', 'rainbow']);

	await server.close();
});

test('aborting a request', withPage, async (t: ExecutionContext, page: Page) => {
	const server = await createEsmTestServer();

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

	const error = await page.evaluate(async url => {
		const controller = new AbortController();
		const request = window.ky(`${url}/test`, {signal: controller.signal}).text();
		controller.abort();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'AbortError: Failed to execute \'fetch\' on \'Window\': The user aborted a request.');

	await server.close();
});

test('aborting a request with onDonwloadProgress', withPage, async (t: ExecutionContext, page: Page) => {
	const server = await createEsmTestServer();

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

	const error = await page.evaluate(async url => {
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

	await server.close();
});

test(
	'throws TimeoutError even though it does not support AbortController',
	withPage,
	async (t: ExecutionContext, page: Page) => {
		const server = await createEsmTestServer();

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

		const error = await page.evaluate(async url => {
			const request = window.ky(`${url}/slow`, {timeout: 500}).text();
			return request.catch(error_ => ({
				message: error_.toString(),
				request: {url: error_.request.url},
			}));
		}, server.url);

		if (typeof error !== 'object') {
			throw new TypeError('Expected to have an object error');
		}

		t.is(error.message, 'TimeoutError: Request timed out');
		t.is(error.request.url, `${server.url}/slow`);

		await server.close();
	},
);

test('onDownloadProgress works', withPage, async (t: ExecutionContext, page: Page) => {
	const server = await createEsmTestServer();

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

	const result = await page.evaluate(async url => {
		// `new TextDecoder('utf-8').decode` hangs up?
		const decodeUtf8 = (array: Uint8Array) => String.fromCodePoint(...array);

		const data: any[] = [];
		const text = await window
			.ky(url, {
				onDownloadProgress(progress, chunk) {
					const stringifiedChunk = decodeUtf8(chunk);
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

	await server.close();
});

test('throws if onDownloadProgress is not a function', withPage, async (t: ExecutionContext, page: Page) => {
	const server = await createEsmTestServer();

	server.get('/', (_request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await addKyScriptToPage(page);

	const error = await page.evaluate(async url => {
		// @ts-expect-error
		const request = window.ky(url, {onDownloadProgress: 1}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'TypeError: The `onDownloadProgress` option must be a function');

	await server.close();
});

test('throws if does not support ReadableStream', withPage, async (t: ExecutionContext, page: Page) => {
	const server = await createEsmTestServer();

	server.get('/', (_request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({content: 'window.ReadableStream = undefined;\n'});
	await addKyScriptToPage(page);

	const error = await page.evaluate(async url => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const request = window.ky(url, {onDownloadProgress() {}}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'Error: Streams are not supported in your environment. `ReadableStream` is missing.');

	await server.close();
});

test('FormData with searchParams', withPage, async (t: ExecutionContext, page: Page) => {
	t.plan(3);

	const server = await createEsmTestServer({bodyParser: false});

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

	await page.evaluate(async url => {
		const formData = new window.FormData();
		formData.append('file', new window.File(['bubblegum pie'], 'my-file'));
		return window.ky(url, {
			method: 'post',
			searchParams: 'foo=1',
			body: formData,
		});
	}, server.url);

	await server.close();
});

test('FormData with searchParams ("multipart/form-data" parser)', withPage, async (t: ExecutionContext, page: Page) => {
	t.plan(3);

	const server = await createEsmTestServer();

	server.get('/', (_request, response) => {
		response.end();
	});

	server.post('/', async (request, response) => {
		const [body, error] = await new Promise(resolve => {
			// @ts-expect-error
			const busboy = new Busboy({headers: request.headers});

			busboy.on('error', (error: Error) => {
				resolve([null, error]);
			});

			// eslint-disable-next-line max-params
			busboy.on('file', async (fieldname, file, filename, encoding, mimetype) => {
				let fileContent = '';
				try {
					for await (const chunk of file) {
						fileContent += chunk; // eslint-disable-line @typescript-eslint/restrict-plus-operands
					}

					resolve([{fieldname, filename, encoding, mimetype, fileContent}, undefined]);
				} catch (error_: unknown) {
					resolve([null, error_]);
				}
			});

			busboy.on('finish', () => {
				response.writeHead(303, {Connection: 'close', Location: '/'});
				response.end();
			});

			setTimeout(() => {
				resolve([null, new Error('Timeout')]);
			}, 3000);

			request.pipe(busboy);
		});

		t.falsy(error);
		t.deepEqual(request.query, {foo: '1'});
		t.deepEqual(body, {
			fieldname: 'file',
			filename: 'my-file',
			encoding: '7bit',
			mimetype: 'text/plain',
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

	await server.close();
});

test(
	'headers are preserved when input is a Request and there are searchParams in the options',
	withPage,
	async (t: ExecutionContext, page: Page) => {
		t.plan(2);

		const server = await createEsmTestServer();

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

		await page.evaluate(async url => {
			const request = new window.Request(url + '/test', {
				headers: {'content-type': 'text/css'},
			});

			return window
				.ky(request, {
					searchParams: 'foo=1',
				})
				.text();
		}, server.url);

		await server.close();
	},
);

test('retry with body', withPage, async (t: ExecutionContext, page: Page) => {
	t.plan(4);

	let requestCount = 0;

	const server = await createEsmTestServer();

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
		page.evaluate(async url => window.ky(url + '/test', {
			body: 'foo',
			method: 'PUT',
			retry: 2,
		}), server.url),
		{message: /HTTPError: Request failed with status code 502 Bad Gateway/},
	);

	t.is(requestCount, 2);

	await server.close();
});
