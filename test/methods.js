import test from 'ava';
import createTestServer from 'create-test-server';
import ky from '..';

test('common method is normalized', async t => {
	const server = await createTestServer();
	server.all('/', (request, response) => {
		response.end();
	});

	await t.notThrowsAsync(ky(server.url, {
		method: 'get',
		hooks: {
			beforeRequest: [
				(_input, options) => {
					t.is(options.method, 'GET');
				}
			]
		}
	}));

	await server.close();
});

test('custom method remains identical', async t => {
	const server = await createTestServer();
	server.all('/', (request, response) => {
		response.end();
	});

	await t.notThrowsAsync(ky(server.url, {
		method: 'report',
		hooks: {
			beforeRequest: [
				(_input, options) => {
					t.is(options.method, 'report');
				}
			]
		}
	}));

	await server.close();
});

test('shortcut headers have correct accept headers set', async t => {
	const server = await createTestServer();
	server.all('/', (request, response) => {
		t.is(request.headers.accept, 'text/*');
		response.end('whatever');
	});

	await ky.get(server.url).text();

	await server.close();
});
