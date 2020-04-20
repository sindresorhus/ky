import util from 'util';
import body from 'body';
import {serial as test} from 'ava';
import createTestServer from 'create-test-server';
import Busboy from 'busboy';
import withPage from './helpers/with-page';

const pBody = util.promisify(body);

test('prefixUrl option', withPage, async (t, page) => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end('zebra');
	});
	server.get('/api/unicorn', (request, response) => {
		response.end('rainbow');
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	await t.throwsAsync(async () => {
		return page.evaluate(() => {
			return window.ky('/foo', {prefixUrl: '/'});
		});
	}, {message: /`input` must not begin with a slash when using `prefixUrl`/});

	const unprefixed = await page.evaluate(url => {
		return window.ky(`${url}/api/unicorn`).text();
	}, server.url);
	t.is(unprefixed, 'rainbow');

	const prefixed = await page.evaluate(prefixUrl => {
		return window.ky('api/unicorn', {prefixUrl}).text();
	}, server.url);
	t.is(prefixed, 'rainbow');

	await server.close();
});

test('aborting a request', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end('meow');
	});

	server.get('/test', (request, response) => {
		setTimeout(() => {
			response.end('ok');
		}, 500);
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	const error = await page.evaluate(url => {
		const controller = new AbortController();
		const request = window.ky(`${url}/test`, {signal: controller.signal}).text();
		controller.abort();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'AbortError: The user aborted a request.');

	await server.close();
});

test('throws TimeoutError even though it does not support AbortController', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end();
	});

	server.get('/slow', (request, response) => {
		setTimeout(() => {
			response.end('ok');
		}, 1000);
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './test/helpers/disable-abort-controller.js'});
	await page.addScriptTag({path: './umd.js'});

	const error = await page.evaluate(url => {
		const request = window.ky(`${url}/slow`, {timeout: 500}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'TimeoutError: Request timed out');

	await server.close();
});

test('onDownloadProgress works', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.writeHead(200, {
			'content-length': 4
		});

		response.write('me');
		setTimeout(() => {
			response.end('ow');
		}, 1000);
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	const result = await page.evaluate(async url => {
		// `new TextDecoder('utf-8').decode` hangs up?
		const decodeUTF8 = array => String.fromCharCode(...array);

		const data = [];
		const text = await window.ky(url, {
			onDownloadProgress: (progress, chunk) => {
				const stringifiedChunk = decodeUTF8(chunk);
				data.push([progress, stringifiedChunk]);
			}
		}).text();

		return {data, text};
	}, server.url);

	t.deepEqual(result.data, [
		[{percent: 0, transferredBytes: 0, totalBytes: 4}, ''],
		[{percent: 0.5, transferredBytes: 2, totalBytes: 4}, 'me'],
		[{percent: 1, transferredBytes: 4, totalBytes: 4}, 'ow']
	]);
	t.is(result.text, 'meow');

	await server.close();
});

test('throws if onDownloadProgress is not a function', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	const error = await page.evaluate(url => {
		const request = window.ky(url, {onDownloadProgress: 1}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'TypeError: The `onDownloadProgress` option must be a function');

	await server.close();
});

test('throws if does not support ReadableStream', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './test/helpers/disable-stream-support.js'});
	await page.addScriptTag({path: './umd.js'});

	const error = await page.evaluate(url => {
		const request = window.ky(url, {onDownloadProgress: () => {}}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'Error: Streams are not supported in your environment. `ReadableStream` is missing.');

	await server.close();
});

test('FormData with searchParams', withPage, async (t, page) => {
	t.plan(3);

	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end();
	});
	server.post('/', async (request, response) => {
		const requestBody = await pBody(request);
		const contentType = request.headers['content-type'];
		const boundary = contentType.split('boundary=')[1];

		t.truthy(requestBody.includes(boundary));
		t.regex(requestBody, /bubblegum pie/);
		t.deepEqual(request.query, {foo: '1'});
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});
	await page.evaluate(url => {
		const formData = new window.FormData();
		formData.append('file', new window.File(['bubblegum pie'], 'my-file'));
		return window.ky(url, {
			method: 'post',
			searchParams: 'foo=1',
			body: formData
		});
	}, server.url);

	await server.close();
});

test('FormData with searchParams ("multipart/form-data" parser)', withPage, async (t, page) => {
	t.plan(3);
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end();
	});
	server.post('/', async (request, response) => {
		const [body, error] = await new Promise(resolve => {
			const busboy = new Busboy({headers: request.headers});
			busboy.on('error', error => resolve([null, error]));
			busboy.on('file', async (fieldname, file, filename, encoding, mimetype) => {
				let fileContent = '';
				try {
					for await (const chunk of file) {
						fileContent += chunk;
					}

					resolve([{fieldname, filename, encoding, mimetype, fileContent}]);
				} catch (error_) {
					resolve([null, error_]);
				}
			});
			busboy.on('finish', () => {
				response.writeHead(303, {Connection: 'close', Location: '/'});
				response.end();
			});
			setTimeout(() => resolve([null, new Error('Timeout')]), 3000);
			request.pipe(busboy);
		});

		t.falsy(error);
		t.deepEqual(request.query, {foo: '1'});
		t.deepEqual(body, {
			fieldname: 'file',
			filename: 'my-file',
			encoding: '7bit',
			mimetype: 'text/plain',
			fileContent: 'bubblegum pie'
		});
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});
	await page.evaluate(url => {
		const formData = new window.FormData();
		formData.append('file', new window.File(['bubblegum pie'], 'my-file', {type: 'text/plain'}));
		return window.ky(url, {
			method: 'post',
			searchParams: 'foo=1',
			body: formData
		});
	}, server.url);
	await server.close();
});

test('headers are preserved when input is a Request and there are searchParams in the options', withPage, async (t, page) => {
	t.plan(2);

	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end();
	});
	server.get('/test', (request, response) => {
		t.is(request.headers['content-type'], 'text/css');
		t.deepEqual(request.query, {foo: '1'});
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	await page.evaluate(url => {
		const request = new window.Request(url + '/test', {
			headers: {'content-type': 'text/css'}
		});
		return window.ky(request, {
			searchParams: 'foo=1'
		}).text();
	}, server.url);

	await server.close();
});

test('retry with body', withPage, async (t, page) => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end('zebra');
	});
	server.put('/test', async (request, response) => {
		requestCount++;
		await pBody(request);
		response.sendStatus(502);
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	const error = await page.evaluate(url => {
		const request = window.ky(url + '/test', {
			body: 'foo',
			method: 'PUT',
			retry: 2
		}).text();
		return request.catch(error_ => error_.toString());
	}, server.url);
	t.is(error, 'HTTPError: Bad Gateway');
	t.is(requestCount, 2);

	await server.close();
});
