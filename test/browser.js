import test from 'ava';
import createTestServer from 'create-test-server';
import withPage from './helpers/with-page';

test('prefixUrl option', withPage, async (t, page) => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		if (request.query.page === '/https://cat.com/') {
			response.end('meow');
			return;
		}

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

	let text = await page.evaluate(url => {
		return window.ky(`${url}/api/unicorn`).text();
	}, server.url);
	t.is(text, 'rainbow');

	text = await page.evaluate(prefixUrl => {
		return window.ky('api/unicorn', {prefixUrl}).text();
	}, server.url);
	t.is(text, 'rainbow');

	await server.close();
});

test('aborting a request', withPage, async (t, page) => {
	const server = await createTestServer();
	server.get('/', (req, res) => res.end('meow'));
	server.get('/test', (req, res) => setTimeout(() => res.end('ok'), 500));

	await page.goto(server.url);
	await page.addScriptTag({path: './umd.js'});

	const err = await page.evaluate(url => {
		return new Promise(resolve => {
			window.ky = window.ky.default;
			const controller = new AbortController();
			const req = window.ky(`${url}/test`, {signal: controller.signal}).text();
			controller.abort();
			req.then(resolve).catch(error => resolve(error.toString()));
		});
	}, server.url);
	t.is(err, 'AbortError: The user aborted a request.');

	await server.close();
});

