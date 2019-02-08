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
