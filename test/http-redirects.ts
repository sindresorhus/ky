import test from 'ava';
import ky, {HTTPError, NetworkError} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';
import {parseRawBody} from './helpers/parse-body.js';

// Fetch §4.5 steps 12 and 14 specify method rewriting and body replay; RFC 9110 §§15.4.2–15.4.4, 15.4.8–15.4.9 define these statuses.
// https://fetch.spec.whatwg.org/#http-redirect-fetch
for (const [status, method, redirectedMethod] of [
	[301, 'POST', 'GET'],
	[302, 'POST', 'GET'],
	[303, 'POST', 'GET'],
	[303, 'PUT', 'GET'],
	[301, 'PUT', 'PUT'],
	[302, 'PATCH', 'PATCH'],
	[307, 'POST', 'POST'],
	[308, 'PUT', 'PUT'],
] as const) {
	test(`${status} redirects ${method} as ${redirectedMethod} with the expected body and headers`, async t => {
		const server = await createHttpTestServer(t, {bodyParser: false});
		const body = 'redirect payload';
		const requests: Array<{method: string; body: string}> = [];
		const bodyHeaders = {
			'content-type': 'text/plain',
			'content-encoding': 'identity',
			'content-language': 'en',
			'content-location': '/representation',
		};
		server.all('/start', async (request, response) => {
			requests.push({method: request.method, body: await parseRawBody(request)});
			response.writeHead(status, {location: '/destination'}).end();
		});
		server.all('/destination', async (request, response) => {
			requests.push({method: request.method, body: await parseRawBody(request)});
			response.json(request.headers);
		});

		const response = await ky(`${server.url}/start`, {
			method,
			body,
			headers: {...bodyHeaders, 'x-preserved': 'yes'},
			retry: 0,
		});
		const headers = await response.json<Record<string, string>>();
		t.deepEqual(requests, [
			{method, body},
			{method: redirectedMethod, body: redirectedMethod === 'GET' ? '' : body},
		]);
		t.is(headers['x-preserved'], 'yes');
		for (const [name, value] of Object.entries(bodyHeaders)) {
			t.is(headers[name], redirectedMethod === 'GET' ? undefined : value);
		}

		// RFC 9110 §15.4 requires removing content-specific headers when switching to GET.
		t.is(headers['content-length'], redirectedMethod === 'GET' ? undefined : String(body.length));
		t.is(response.url, `${server.url}/destination`);
		t.true(response.redirected);
	});
}

// Fetch §4.5 step 12 excludes both GET and HEAD from the 303 rewrite.
for (const method of ['GET', 'HEAD'] as const) {
	test(`303 preserves ${method}`, async t => {
		const server = await createHttpTestServer(t);
		const methods: string[] = [];
		server.all('/start', (request, response) => {
			methods.push(request.method);
			response.writeHead(303, {location: '/destination'}).end();
		});
		server.all('/destination', (request, response) => {
			methods.push(request.method);
			response.set('x-method', request.method).end('destination');
		});

		const response = await ky(`${server.url}/start`, {method, retry: 0});
		t.deepEqual(methods, [method, method]);
		t.is(response.headers.get('x-method'), method);
		t.is(await response.text(), method === 'HEAD' ? '' : 'destination');
	});
}

// Fetch §4.4 step 6.3 controls redirect modes. Node exposes the actual manual response instead of a browser's opaque-redirect response.
// https://github.com/nodejs/undici#manual-redirect
for (const throwHttpErrors of [undefined, false]) {
	test(`manual redirects are not followed with throwHttpErrors ${throwHttpErrors ?? 'default'}`, async t => {
		const server = await createHttpTestServer(t);
		const paths: string[] = [];
		server.use((request, response) => {
			paths.push(request.path);
			response.writeHead(302, {location: '/destination', 'content-type': 'text/plain'}).end('Moved');
		});

		const result = ky(`${server.url}/start`, {redirect: 'manual', throwHttpErrors, retry: 0});
		if (throwHttpErrors === undefined) {
			const error = await t.throwsAsync(result, {instanceOf: HTTPError});
			t.is(error.response.status, 302);
			t.is(error.response.headers.get('location'), '/destination');
			t.is(error.data, 'Moved');
		} else {
			const response = await result;
			t.is(response.status, 302);
			t.is(response.headers.get('location'), '/destination');
			t.false(response.redirected);
			t.is(await response.text(), 'Moved');
		}

		t.deepEqual(paths, ['/start']);
	});
}

test('redirect error mode produces a NetworkError without following or retrying', async t => {
	const server = await createHttpTestServer(t);
	const paths: string[] = [];
	server.use((request, response) => {
		paths.push(request.path);
		response.writeHead(302, {location: '/destination'}).end();
	});

	await t.throwsAsync(ky(`${server.url}/start`, {redirect: 'error', retry: 0}), {instanceOf: NetworkError});
	t.deepEqual(paths, ['/start']);
});

test('relative Location resolves against the redirecting request URL', async t => {
	// RFC 9110 §10.2.2: https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.2
	const server = await createHttpTestServer(t);
	const paths: string[] = [];
	server.get('/directory/start', (request, response) => {
		paths.push(request.url);
		response.writeHead(302, {location: '../destination?from=redirect'}).end();
	});
	server.get('/destination', (request, response) => {
		paths.push(request.url);
		response.end('arrived');
	});

	const response = await ky(`${server.url}/directory/start?original=yes`, {retry: 0});
	t.is(await response.text(), 'arrived');
	t.deepEqual(paths, ['/directory/start?original=yes', '/destination?from=redirect']);
	t.is(response.url, `${server.url}/destination?from=redirect`);
});

test('a redirect status without Location remains an HTTPError', async t => {
	// Fetch §4.5 step 4 returns the response when there is no location URL.
	const server = await createHttpTestServer(t);
	let requests = 0;
	server.get('/', (_request, response) => {
		requests++;
		response.status(302).type('text').end('No destination');
	});

	const error = await t.throwsAsync(ky(server.url, {retry: 0}), {instanceOf: HTTPError});
	t.is(error.response.status, 302);
	t.is(error.data, 'No destination');
	t.is(requests, 1);
});
