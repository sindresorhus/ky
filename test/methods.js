import test from 'ava';
import createTestServer from 'create-test-server';
import ky from '..';

test('common method is normalized', async t => {
	const server = await createTestServer();
	server.all('/', (request, response) => {
		response.end();
	});

	await t.notThrowsAsync(() => ky(server.url, {
		method: 'get',
		hooks: {
			beforeRequest: [
				options => {
					t.is(options.method, 'GET');
				}
			]
		}
	}).raw());

	await server.close();
});

test('custom method remains identical', async t => {
	const server = await createTestServer();
	server.all('/', (request, response) => {
		response.end();
	});

	await t.notThrowsAsync(() => ky(server.url, {
		method: 'report',
		hooks: {
			beforeRequest: [
				options => {
					t.is(options.method, 'report');
				}
			]
		}
	}).raw());

	await server.close();
});
