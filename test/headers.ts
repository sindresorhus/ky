import {Buffer} from 'node:buffer';
import process from 'node:process';
import type {IncomingHttpHeaders} from 'node:http';
import test from 'ava';
import type {RequestHandler} from 'express';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const timeout = 60_000;

const echoHeaders: RequestHandler = (request, response) => {
	request.resume();
	response.end(JSON.stringify(request.headers));
};

test.serial('works with nullish headers even in old browsers', async t => {
	t.plan(4);

	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const OriginalHeaders = Headers;
	// Some old browsers throw for new Headers(undefined) or new Headers(null)
	// so we check that Ky never does that and passes an empty object instead.
	// See: https://github.com/sindresorhus/ky/issues/260
	globalThis.Headers = class Headers extends OriginalHeaders {
		constructor(headersInit?: RequestInit['headers']) {
			t.deepEqual(headersInit, {});
			super(headersInit);
		}
	};
	const response = await ky.get(server.url).json<IncomingHttpHeaders>();

	t.is(typeof response, 'object');
	t.truthy(response);

	await server.close();

	globalThis.Headers = OriginalHeaders;
});

test('`user-agent`', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky.get(server.url).json<IncomingHttpHeaders>();
	t.is(headers['user-agent'], 'node');

	await server.close();
});

test('`accept-encoding`', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky.get(server.url).json<IncomingHttpHeaders>();

	t.is(headers['accept-encoding'], 'gzip, deflate');

	await server.close();
});

test('does not override provided `accept-encoding`', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky
		.get(server.url, {
			headers: {
				'accept-encoding': 'gzip',
			},
		})
		.json<IncomingHttpHeaders>();
	t.is(headers['accept-encoding'], 'gzip');

	await server.close();
});

test('does not remove user headers from `url` object argument', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky
		.get(server.url, {
			headers: {
				'X-Request-Id': 'value',
			},
		})
		.json<IncomingHttpHeaders>();

	t.is(headers.accept, 'application/json');
	t.is(headers['user-agent'], 'node');
	t.is(headers['accept-encoding'], 'gzip, deflate');
	t.is(headers['x-request-id'], 'value');

	await server.close();
});

test('`accept` header with `json` option', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	let headers = await ky.get(server.url).json<IncomingHttpHeaders>();
	t.is(headers.accept, 'application/json');

	headers = await ky
		.get(server.url, {
			headers: {
				accept: '',
			},
		})
		.json<IncomingHttpHeaders>();

	t.is(headers.accept, 'application/json');

	await server.close();
});

test('`host` header', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky.get(server.url).json<IncomingHttpHeaders>();
	t.is(headers.host, `localhost:${server.port}`);

	await server.close();
});

test('transforms names to lowercase', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky(server.url, {
		headers: {
			'ACCEPT-ENCODING': 'identity',
		},
	}).json<IncomingHttpHeaders>();
	t.is(headers['accept-encoding'], 'identity');

	await server.close();
});

test('setting `content-length` to 0', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const request = ky
		.post(server.url, {
			headers: {
				'content-length': '0',
			},
			body: 'sup',
		})
		.json<IncomingHttpHeaders>();

	const error = await t.throwsAsync(request);

	t.is(error.cause?.code, 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH');

	await server.close();
});

test('sets `content-length` to `0` when requesting PUT with empty body', async t => {
	const server = await createHttpTestServer();
	server.put('/', echoHeaders);

	const headers = await ky.put(server.url).json<IncomingHttpHeaders>();

	t.is(headers['content-length'], '0');

	await server.close();
});

test('json manual `content-type` header', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const headers = await ky
		.post(server.url, {
			headers: {
				'content-type': 'custom',
			},
			json: {
				foo: true,
			},
		})
		.json<IncomingHttpHeaders>();

	t.is(headers['content-type'], 'custom');

	await server.close();
});

test('form-data manual `content-type` header', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const form = new FormData();
	form.append('a', 'b');
	const headers = await ky
		.post(server.url, {
			headers: {
				'content-type': 'custom',
			},
			// @ts-expect-error FormData type mismatch
			body: form,
		})
		.json<IncomingHttpHeaders>();

	t.is(headers['content-type'], 'custom');

	await server.close();
});

test('form-data automatic `content-type` header', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const form = new FormData();
	form.append('a', 'b');
	const headers = await ky
		.post(server.url, {
			// @ts-expect-error FormData type mismatch
			body: form,
		})
		.json<IncomingHttpHeaders>();

	// eslint-disable-next-line ava/assertion-arguments
	t.true(headers['content-type'].startsWith('multipart/form-data; boundary='), headers['content-type']);

	await server.close();
});

test('form-data manual `content-type` header with search params', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const form = new FormData();
	form.append('a', 'b');
	const headers = await ky
		.post(server.url, {
			searchParams: 'foo=1',
			headers: {
				'content-type': 'custom',
			},
			// @ts-expect-error FormData type mismatch
			body: form,
		})
		.json<IncomingHttpHeaders>();

	t.is(headers['content-type'], 'custom');

	await server.close();
});

test('form-data automatic `content-type` header with search params', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const form = new FormData();
	form.append('a', 'b');
	const headers = await ky
		.post(server.url, {
			searchParams: 'foo=1',
			// @ts-expect-error FormData type mismatch
			body: form,
		})
		.json<IncomingHttpHeaders>();

	// eslint-disable-next-line ava/assertion-arguments
	t.true(headers['content-type'].startsWith('multipart/form-data; boundary='), headers['content-type']);

	await server.close();
});

test('form-data sets `content-length` header', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const form = new FormData();
	form.append('a', 'b');

	const headers = await ky.post(server.url, {body: form}).json<IncomingHttpHeaders>();

	// Undici 6.21.3+ added trailing CRLF to FormData (backported from 7.1.0)
	// Older versions: 119 bytes (without CRLF)
	// Newer versions: 121 bytes (with CRLF)
	// Eventually this should only check for '121' when older Node.js versions are dropped
	t.true(headers['content-length'] === '119' || headers['content-length'] === '121');

	await server.close();
});

test('buffer as `options.body` sets `content-length` header', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const buffer = Buffer.from('unicorn');
	const headers = await ky
		.post(server.url, {
			body: buffer,
		})
		.json<IncomingHttpHeaders>();

	t.is(Number(headers['content-length']), buffer.length);

	await server.close();
});

test.failing('removes undefined value headers', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky
		.get(server.url, {
			headers: {
				'user-agent': undefined,
				unicorn: 'unicorn',
			},
		})
		.json<IncomingHttpHeaders>();

	t.is(headers['user-agent'], 'undefined');
	t.is(headers['unicorn'], 'unicorn');

	await server.close();
});

test('non-existent headers set to undefined are omitted', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky
		.get(server.url, {
			headers: {
				blah: undefined,
				rainbow: 'unicorn',
			},
		})
		.json<IncomingHttpHeaders>();

	t.false('blah' in headers);
	t.true('rainbow' in headers);

	await server.close();
});

test('preserve port in host header if non-standard port', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const body = await ky.get(server.url).json<IncomingHttpHeaders>();
	t.is(body.host, `localhost:${server.port}`);

	await server.close();
});

test('strip port in host header if explicit standard port (:80) & protocol (HTTP)', async t => {
	const customFetch: typeof fetch = async () => new Response(
		JSON.stringify({headers: {Host: 'httpbin.org'}}),
		{status: 200, headers: {'content-type': 'application/json'}},
	);

	const body = await ky.get('http://httpbin.org:80/headers', {fetch: customFetch}).json<{headers: IncomingHttpHeaders}>();
	t.is(body.headers['Host'], 'httpbin.org');
});

test('strip port in host header if explicit standard port (:443) & protocol (HTTPS)', async t => {
	const customFetch: typeof fetch = async () => new Response(
		JSON.stringify({headers: {Host: 'httpbin.org'}}),
		{status: 200, headers: {'content-type': 'application/json'}},
	);

	const body = await ky.get('https://httpbin.org:443/headers', {fetch: customFetch}).json<{headers: IncomingHttpHeaders}>();
	t.is(body.headers['Host'], 'httpbin.org');
});

test('strip port in host header if implicit standard port & protocol (HTTP)', async t => {
	const customFetch: typeof fetch = async () => new Response(
		JSON.stringify({headers: {Host: 'httpbin.org'}}),
		{status: 200, headers: {'content-type': 'application/json'}},
	);

	const body = await ky.get('http://httpbin.org/headers', {fetch: customFetch}).json<{headers: IncomingHttpHeaders}>();
	t.is(body.headers['Host'], 'httpbin.org');
});

test('strip port in host header if implicit standard port & protocol (HTTPS)', async t => {
	const customFetch: typeof fetch = async () => new Response(
		JSON.stringify({headers: {Host: 'httpbin.org'}}),
		{status: 200, headers: {'content-type': 'application/json'}},
	);

	const body = await ky.get('https://httpbin.org/headers', {fetch: customFetch}).json<{headers: IncomingHttpHeaders}>();
	t.is(body.headers['Host'], 'httpbin.org');
});

test('remove custom header by extending instance (plain objects)', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const original = ky.create({
		headers: {
			rainbow: 'rainbow',
			unicorn: 'unicorn',
		},
	});

	const extended = original.extend({
		headers: {
			rainbow: undefined,
		},
	});

	const response = await extended(server.url).json<IncomingHttpHeaders>();

	t.true('unicorn' in response);
	t.false('rainbow' in response);

	await server.close();
});

test('remove header by extending instance (Headers instance)', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const original = ky.create({
		headers: new Headers({
			rainbow: 'rainbow',
			unicorn: 'unicorn',
		}),
	});

	const extended = original.extend({
		// @ts-expect-error Headers does not support undefined values
		headers: new Headers({
			rainbow: undefined,
		}),
	});

	const response = await extended(server.url).json<IncomingHttpHeaders>();

	t.false('rainbow' in response);
	t.true('unicorn' in response);

	await server.close();
});

test('remove header by extending instance (Headers instance and plain object)', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const original = ky.create({
		headers: new Headers({
			rainbow: 'rainbow',
			unicorn: 'unicorn',
		}),
	});

	const extended = original.extend({
		headers: {
			rainbow: undefined,
		},
	});

	const response = await extended(server.url).json<IncomingHttpHeaders>();

	t.false('rainbow' in response);
	t.true('unicorn' in response);

	await server.close();
});

test('remove header by extending instance (plain object and Headers instance)', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const original = ky.create({
		headers: {
			rainbow: 'rainbow',
			unicorn: 'unicorn',
		},
	});

	const extended = original.extend({
		// @ts-expect-error Headers does not support undefined values
		headers: new Headers({
			rainbow: undefined,
		}),
	});

	const response = await extended(server.url).json<IncomingHttpHeaders>();

	t.false('rainbow' in response);
	t.true('unicorn' in response);

	await server.close();
});
