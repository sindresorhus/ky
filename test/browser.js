import test from 'ava';
import createTestServer from 'create-test-server';
import withPage from './helpers/with-page';

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
		window.ky = window.ky.default;
		const controller = new AbortController();
		const request = window.ky(`${url}/test`, {signal: controller.signal}).text();
		controller.abort();
		return request.catch(error => error.toString());
	}, server.url);
	t.is(error, 'AbortError: The user aborted a request.');

	await server.close();
});

test('onProgress works', withPage, async (t, page) => {
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
		const data = [];
		window.ky = window.ky.default;

		const text = await window.ky(url, {
			onProgress: (percent, transferred, total) => {
				data.push([percent, transferred, total]);
			}
		}).text();

		return {data, text};
	}, server.url);

	t.deepEqual(result.data, [
		[0, 0, 4],
		[0.5, 2, 4],
		[1, 4, 4]
	]);
	t.is(result.text, 'meow');

	await server.close();
});

test('throws if onProgress is not a function', withPage, async (t, page) => {
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end();
	});

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	const error = await page.evaluate(url => {
		window.ky = window.ky.default;
		const request = window.ky(url, {onProgress: 1}).text();
		return request.catch(error => error.toString());
	}, server.url);
	t.is(error, 'TypeError: The `onProgress` option must be a function');

	await server.close();
});
