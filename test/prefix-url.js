import test from 'ava';
import createTestServer from 'create-test-server';
import ky from '..';

test('prefixUrl option', async t => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end('zebra');
	});
	server.get('/api/unicorn', (request, response) => {
		response.end('rainbow');
	});

	t.is(await ky(`${server.url}/api/unicorn`, {prefixUrl: false}).text(), 'rainbow');
	t.is(await ky(`${server.url}/api/unicorn`, {prefixUrl: ''}).text(), 'rainbow');
	t.is(await ky(new URL(`${server.url}/api/unicorn`), {prefixUrl: ''}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {prefixUrl: server.url}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {prefixUrl: new URL(server.url)}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: `${server.url}/api`}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: `${server.url}/api/`}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: new URL(`${server.url}/api`)}).text(), 'rainbow');
	t.is(await ky('', {prefixUrl: server.url}).text(), 'zebra');
	t.is(await ky('', {prefixUrl: `${server.url}/`}).text(), 'zebra');
	t.is(await ky('', {prefixUrl: new URL(server.url)}).text(), 'zebra');

	t.throws(() => {
		ky('/unicorn', {prefixUrl: `${server.url}/api`});
	}, {
		message: '`input` must not begin with a slash when using `prefixUrl`'
	});

	await server.close();
});
