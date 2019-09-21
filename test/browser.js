import test from 'ava';
import createTestServer from 'create-test-server';
import withPage from './helpers/with-page';

test.serial('prefixUrl option', withPage, async (t, page) => {
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
			window.ky = window.ky.default;

			return window.ky('/foo', {prefixUrl: '/'});
		});
	}, /`input` must not begin with a slash when using `prefixUrl`/);

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

test.serial('aborting a request', withPage, async (t, page) => {
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
		window.ky = window.ky.default;

		const controller = new AbortController();
		const request = window.ky(`${url}/test`, {signal: controller.signal}).text();
		controller.abort();
		return request.catch(error => error.toString());
	}, server.url);
	t.is(error, 'AbortError: The user aborted a request.');

	await server.close();
});

test.serial('throws TimeoutError even though it does not support AbortController', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end();
	});

	server.get('/endless', () => {});

	await page.goto(server.url);
	await page.addScriptTag({path: './test/helpers/disable-abort-controller.js'});
	await page.addScriptTag({path: './umd.js'});

	// TODO: make set a timeout for this evaluation so we don't have to wait 30s
	const error = await page.evaluate(url => {
		window.ky = window.ky.default;

		const request = window.ky(`${url}/endless`, {timeout: 500}).text();
		return request.catch(error => error.toString());
	}, server.url);
	t.is(error, 'TimeoutError: Request timed out');

	// A note from @szmarczak: await server.close() hangs on my machine
	await server.close();
});

test.serial('onDownloadProgress works', withPage, async (t, page) => {
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
		window.ky = window.ky.default;

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

test.serial('throws if onDownloadProgress is not a function', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	const error = await page.evaluate(url => {
		window.ky = window.ky.default;

		const request = window.ky(url, {onDownloadProgress: 1}).text();
		return request.catch(error => error.toString());
	}, server.url);
	t.is(error, 'TypeError: The `onDownloadProgress` option must be a function');

	await server.close();
});

test.serial('throws if does not support ReadableStream', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './test/helpers/disable-stream-support.js'});
	await page.addScriptTag({path: './umd.js'});

	const error = await page.evaluate(url => {
		window.ky = window.ky.default;

		const request = window.ky(url, {onDownloadProgress: () => {}}).text();
		return request.catch(error => error.toString());
	}, server.url);
	t.is(error, 'Error: Streams are not supported in your environment. `ReadableStream` is missing.');

	await server.close();
});
