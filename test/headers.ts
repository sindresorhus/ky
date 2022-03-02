import {Buffer} from 'node:buffer';
import type {IncomingHttpHeaders} from 'node:http';
import test from 'ava';
import type {RequestHandler} from 'express';
import FormData from 'form-data';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

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
		constructor(headersInit?: HeadersInit | undefined) {
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
	t.is(headers['user-agent'], 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)');
});

test('`accept-encoding`', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky.get(server.url).json<IncomingHttpHeaders>();

	t.is(headers['accept-encoding'], 'gzip,deflate');
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
	t.is(headers['user-agent'], 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)');
	t.is(headers['accept-encoding'], 'gzip,deflate');
	t.is(headers['x-request-id'], 'value');
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
});

test('`host` header', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky.get(server.url).json<IncomingHttpHeaders>();
	t.is(headers.host, `localhost:${server.port}`);
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
});

test('setting `content-length` to 0', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const headers = await ky
		.post(server.url, {
			headers: {
				'content-length': '0',
			},
			body: 'sup',
		})
		.json<IncomingHttpHeaders>();

	t.is(headers['content-length'], '3');
});

test('sets `content-length` to `0` when requesting PUT with empty body', async t => {
	const server = await createHttpTestServer();
	server.put('/', echoHeaders);

	const headers = await ky.put(server.url).json<IncomingHttpHeaders>();

	t.is(headers['content-length'], '0');
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

	t.is(headers['content-type'], `multipart/form-data;boundary=${form.getBoundary()}`);
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

	t.is(headers['content-type'], `multipart/form-data;boundary=${form.getBoundary()}`);
});

test('form-data sets `content-length` header', async t => {
	const server = await createHttpTestServer();
	server.post('/', echoHeaders);

	const form = new FormData();
	form.append('a', 'b');
	// @ts-expect-error FormData type mismatch
	const headers = await ky.post(server.url, {body: form}).json<IncomingHttpHeaders>();

	t.is(headers['content-length'], '157');
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
});

// TODO: Enable this when node-fetch allows for removal of default headers. Context: https://github.com/node-fetch/node-fetch/issues/591
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
});

test('preserve port in host header if non-standard port', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const body = await ky.get(server.url).json<IncomingHttpHeaders>();
	t.is(body.host, `localhost:${server.port}`);
});

test('strip port in host header if explicit standard port (:80) & protocol (HTTP)', async t => {
	const body = await ky.get('http://httpbin.org:80/headers').json<{headers: IncomingHttpHeaders}>();
	t.is(body.headers['Host'], 'httpbin.org');
});

test('strip port in host header if explicit standard port (:443) & protocol (HTTPS)', async t => {
	const body = await ky.get('https://httpbin.org:443/headers').json<{headers: IncomingHttpHeaders}>();
	t.is(body.headers['Host'], 'httpbin.org');
});

test('strip port in host header if implicit standard port & protocol (HTTP)', async t => {
	const body = await ky.get('http://httpbin.org/headers').json<{headers: IncomingHttpHeaders}>();
	t.is(body.headers['Host'], 'httpbin.org');
});

test('strip port in host header if implicit standard port & protocol (HTTPS)', async t => {
	const body = await ky.get('https://httpbin.org/headers').json<{headers: IncomingHttpHeaders}>();
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
