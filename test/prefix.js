import test from 'ava';
import createTestServer from 'create-test-server';
import ky from '..';

test('prefixUrl option', async t => {
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

	t.is(await ky(server.url + '/api/unicorn', {prefixUrl: ''}).text(), 'rainbow');
	t.is(await ky('/api/unicorn', {prefixUrl: server.url}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: server.url + '/api/'}).text(), 'rainbow');
	t.is(await ky('/unicorn', {prefixUrl: server.url + '/api'}).text(), 'rainbow');
	t.is(await ky('/unicorn', {prefixUrl: server.url + '/api/'}).text(), 'rainbow');
	t.is(await ky('', {prefixUrl: server.url}).text(), 'zebra');
	t.is(await ky('https://cat.com/', {prefixUrl: new URL(server.url + '/?page=')}).text(), 'meow');
	t.is(await ky(new URL('https://cat.com'), {prefixUrl: server.url + '/?page='}).text(), 'meow');
	t.is(await ky(new URL('https://cat.com'), {prefixUrl: new URL(server.url + '/?page=')}).text(), 'meow');

	await server.close();
});
