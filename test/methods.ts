import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('undefined method restores the input default without changing the parent', async t => {
	const url = 'https://example.com';
	const parent = ky.create({
		method: 'POST',
		async fetch(request) {
			return new Response(request.method);
		},
	});
	const extended = parent.extend({method: undefined});

	t.is(await parent(url, {method: undefined}).text(), 'GET');
	t.is(await extended(url).text(), 'GET');
	t.is(await extended(new Request(url, {method: 'PUT'})).text(), 'PUT');
	t.is(await parent(url).text(), 'POST');
});

test('init hooks can reset the request method to the input default', async t => {
	const api = ky.create({
		method: 'POST',
		hooks: {
			init: [options => {
				options.method = undefined;
			}],
		},
		async fetch(request) {
			return new Response(request.method);
		},
	});

	t.is(await api('https://example.com').text(), 'GET');
	t.is(await api(new Request('https://example.com', {method: 'PUT'})).text(), 'PUT');
});

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

// A custom method is passed through with its casing intact. It is asserted on the outgoing request, because an HTTP server may reject an unknown method before the application sees it.
test('custom method remains identical', async t => {
	await t.notThrowsAsync(
		ky('https://example.com', {
			method: 'report',
			hooks: {
				beforeRequest: [
					({options}) => {
						t.is(options.method, 'report');
					},
				],
			},
			async fetch(request) {
				t.is(request.method, 'report');
				return new Response();
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
