import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('common method is normalized', async t => {
	const server = await createHttpTestServer(t);
	server.all('/', (_request, response) => {
		response.end();
	});

	await t.notThrowsAsync(
		ky(server.url, {
			method: 'get',
			hooks: {
				beforeRequest: [
					({options}) => {
						t.is(options.method, 'GET');
					},
				],
			},
		}),
	);
});

test('method defaults to "GET"', async t => {
	const server = await createHttpTestServer(t);
	server.all('/', (_request, response) => {
		response.end();
	});

	t.plan(2);

	await t.notThrowsAsync(
		ky(server.url, {
			hooks: {
				beforeRequest: [
					({options}) => {
						t.is(options.method, 'GET');
					},
				],
			},
		}),
	);
});

test('QUERY method is normalized', async t => {
	const server = await createHttpTestServer(t);
	server.all('/', (_request, response) => {
		response.end();
	});

	t.plan(1);

	await ky(server.url, {
		method: 'query',
		hooks: {
			beforeRequest: [
				({options}) => {
					t.is(options.method, 'QUERY');
				},
			],
		},
	});
});

test('mixed-case standard method is uppercased', async t => {
	const server = await createHttpTestServer(t);
	server.all('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky(server.url, {method: 'Patch'}).text(), 'PATCH');
	t.is(await ky(server.url, {method: 'Query'}).text(), 'QUERY');
	t.is(await ky(server.url, {method: 'Delete'}).text(), 'DELETE');
});

test.failing('custom method remains identical', async t => {
	const server = await createHttpTestServer(t);
	server.all('/', (_request, response) => {
		response.end();
	});

	t.plan(1);

	await t.notThrowsAsync(
		// TODO: Is it correct for this to throw 400 status code?
		ky(server.url, {
			method: 'report',
			hooks: {
				beforeRequest: [
					({options}) => {
						t.is(options.method, 'report');
					},
				],
			},
		}),
	);
});

test('shortcut headers have correct accept headers set', async t => {
	const server = await createHttpTestServer(t);
	server.all('/', (request, response) => {
		t.is(request.headers.accept, 'text/*');
		response.end('whatever');
	});

	await ky.get(server.url).text();
});
