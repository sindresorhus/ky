import test from 'ava';
import createTestServer from 'create-test-server';
import puppeteerHelper from '@ianwalter/puppeteer-helper';
import ky from '..';

const withPage = puppeteerHelper();

async function createServer() {
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
	return server;
}

test('prefixUrl option', async t => {
	const server = await createServer();

	t.is(await ky(`${server.url}/api/unicorn`, {prefixUrl: false}).text(), 'rainbow');
	t.is(await ky(`${server.url}/api/unicorn`, {prefixUrl: ''}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {prefixUrl: server.url}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: `${server.url}/api`}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: `${server.url}/api/`}).text(), 'rainbow');
	t.is(await ky('', {prefixUrl: server.url}).text(), 'zebra');
	t.is(await ky('', {prefixUrl: `${server.url}/`}).text(), 'zebra');
	t.is(await ky('https://cat.com/', {prefixUrl: new URL(`${server.url}/?page=`)}).text(), 'meow');
	t.is(await ky(new URL('https://cat.com'), {prefixUrl: `${server.url}/?page=`}).text(), 'meow');
	t.is(await ky(new URL('https://cat.com'), {prefixUrl: new URL(`${server.url}/?page=`)}).text(), 'meow');

	t.throws(() => {
		ky('/unicorn', {prefixUrl: `${server.url}/api`});
	}, '`input` must not begin with a slash when using `prefixUrl`');

	await server.close();
});

test('prefixUrl option in browser', withPage, async (t, page) => {
	const server = await createServer();
	await page.goto(server.url);
	await page.addScriptTag({path: './dist/ky.iife.js'});

	await t.throwsAsync(async () => {
		return page.evaluate(() => ky.default('/foo', {prefixUrl: '/'}));
	}, /`input` must not begin with a slash when using `prefixUrl`/);

	let text = await page.evaluate(url => {
		return ky.default(`${url}/api/unicorn`).text();
	}, server.url);
	t.is(text, 'rainbow');

	text = await page.evaluate(prefixUrl => {
		return ky.default('api/unicorn', {prefixUrl}).text();
	}, server.url);
	t.is(text, 'rainbow');

	await server.close();
});
