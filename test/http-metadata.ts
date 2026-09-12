import test from 'ava';
import ky, {HTTPError} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

// Node exposes Set-Cookie response headers. Browsers filter them out before Ky receives the response.
// Unlike list-valued fields, Set-Cookie must remain separate, including commas inside Expires (RFC 9110 §5.3).
// https://www.rfc-editor.org/rfc/rfc9110.html#section-5.3
for (const mode of ['plain', 'progress', 'hook replacement', 'custom parser'] as const) {
	test(`response cookies remain separate through ${mode} and cloning`, async t => {
		const server = await createHttpTestServer(t);
		const cookies = ['session=one; Path=/; HttpOnly', 'theme=dark; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/'];
		server.get('/', (_request, response) => {
			response.writeHead(200, {'set-cookie': cookies, vary: ['Accept', 'Accept-Language'], 'content-type': 'application/json'}).end('{"ok":true}');
		});
		let hookCalls = 0;
		let parserCalls = 0;
		let progressCalls = 0;
		const response = await ky(server.url, {
			onDownloadProgress: mode === 'progress'
				? () => {
					progressCalls++;
				}
				: undefined,
			hooks: {
				afterResponse: mode === 'hook replacement'
					? [({response}) => {
						hookCalls++;
						t.deepEqual(response.headers.getSetCookie(), cookies);
						return new Response(response.body, response);
					}]
					: [],
			},
			parseJson: mode === 'custom parser'
				? (text, {response}) => {
					parserCalls++;
					t.deepEqual(response.headers.getSetCookie(), cookies);
					return JSON.parse(text);
				}
				: undefined,
		});
		const clone = response.clone();
		for (const result of [response, clone]) {
			t.deepEqual(result.headers.getSetCookie(), cookies);
			t.is(result.headers.get('vary'), 'Accept, Accept-Language');
			// eslint-disable-next-line no-await-in-loop
			t.deepEqual(await result.json(), {ok: true});
		}

		t.is(hookCalls, mode === 'hook replacement' ? 1 : 0);
		t.is(parserCalls, mode === 'custom parser' ? 2 : 0);
		t.is(progressCalls > 0, mode === 'progress');
	});
}

test('HTTPError retains separate response cookies after parsing error data', async t => {
	const server = await createHttpTestServer(t);
	const cookies = ['session=; Max-Age=0; Path=/', 'notice=expired; Path=/'];
	server.get('/', (_request, response) => {
		response.writeHead(401, {'set-cookie': cookies, 'www-authenticate': 'Bearer realm="example"', 'content-type': 'application/json'}).end('{"error":"expired"}');
	});
	const error = await t.throwsAsync(ky(server.url), {instanceOf: HTTPError});

	t.deepEqual(error.data, {error: 'expired'});
	t.deepEqual(error.response.headers.getSetCookie(), cookies);
	t.is(error.response.headers.get('www-authenticate'), 'Bearer realm="example"');
});

// These fixtures test preservation of preconditions and Ky's error policy, not server-side condition evaluation.
// RFC 9110 §§13.1.1, 13.1.2, and 13.1.4 require 412 when these write preconditions fail.
for (const [name, value] of [
	['if-match', '"old-version", "other-version"'],
	['if-none-match', '*'],
	['if-unmodified-since', 'Wed, 01 Jan 2025 00:00:00 GMT'],
] as const) {
	test(`failed ${name} write preconditions retain metadata and do not retry`, async t => {
		const server = await createHttpTestServer(t);
		let requests = 0;
		server.put('/', (request, response) => {
			requests++;
			t.is(request.headers[name], value);
			t.deepEqual(request.body, {updated: true});
			response.writeHead(412, {etag: '"current-version"', 'content-type': 'application/json'}).end('{"error":"precondition failed"}');
		});
		const error = await t.throwsAsync(ky.put(server.url, {headers: {[name]: value}, json: {updated: true}}), {instanceOf: HTTPError});

		t.is(error.response.status, 412);
		t.is(error.response.headers.get('etag'), '"current-version"');
		t.deepEqual(error.data, {error: 'precondition failed'});
		t.is(requests, 1);
	});
}

test('an If-Range mismatch may return the complete representation as 200', async t => {
	// RFC 9110 §13.1.5: a failed If-Range condition means the server ignores Range.
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		t.is(request.headers.range, 'bytes=5-');
		t.is(request.headers['if-range'], '"old-version"');
		response.writeHead(200, {etag: '"new-version"', 'content-length': '10'}).end('0123456789');
	});
	const response = await ky(server.url, {headers: {range: 'bytes=5-', 'if-range': '"old-version"'}});

	t.is(response.status, 200);
	t.is(response.headers.get('etag'), '"new-version"');
	t.false(response.headers.has('content-range'));
	t.is(await response.text(), '0123456789');
});

test('201 Location identifies the created resource without following it', async t => {
	// RFC 9110 §15.3.2: Location on a 201 is not an HTTP redirect.
	const server = await createHttpTestServer(t);
	const requests: string[] = [];
	server.use((request, response) => {
		requests.push(`${request.method} ${request.path}`);
		response.writeHead(201, {location: '/created/123', 'content-type': 'application/json'}).end('{"id":123}');
	});
	const response = await ky.post(server.url, {json: {name: 'example'}});

	t.is(response.status, 201);
	t.is(response.headers.get('location'), '/created/123');
	t.false(response.redirected);
	t.deepEqual(await response.json(), {id: 123});
	t.deepEqual(requests, ['POST /']);
});

test('202 with Retry-After returns the pending representation without polling', async t => {
	// RFC 9110 §15.3.3 describes acceptance, not completion. Ky does not automatically poll accepted jobs.
	const server = await createHttpTestServer(t);
	let requests = 0;
	server.get('/', (_request, response) => {
		requests++;
		response.writeHead(202, {'retry-after': '0', location: '/jobs/123', 'content-type': 'application/json'}).end('{"pending":true}');
	});
	const response = await ky(server.url);

	t.is(response.status, 202);
	t.is(response.headers.get('retry-after'), '0');
	t.deepEqual(await response.json(), {pending: true});
	t.is(requests, 1);
});

test('300 with Location remains an HTTPError instead of following a redirect', async t => {
	// Fetch only follows 301, 302, 303, 307, and 308: https://fetch.spec.whatwg.org/#redirect-status
	const server = await createHttpTestServer(t);
	const paths: string[] = [];
	server.use((request, response) => {
		paths.push(request.path);
		response.writeHead(300, {location: '/preferred', 'content-type': 'text/plain'}).end('Choose a representation');
	});
	const error = await t.throwsAsync(ky(server.url), {instanceOf: HTTPError});

	t.is(error.response.status, 300);
	t.is(error.response.headers.get('location'), '/preferred');
	t.is(error.data, 'Choose a representation');
	t.deepEqual(paths, ['/']);
});

test('informational responses do not replace the final response or leak their headers', async t => {
	// RFC 9110 §15.2: an informational response precedes the final response.
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.writeEarlyHints({link: '</style.css>; rel=preload; as=style', 'x-early-only': 'hint'});
		response.writeHead(200, {'content-type': 'application/json', 'x-final': 'yes'}).end('{"final":true}');
	});
	const statuses: number[] = [];
	const response = await ky(server.url, {
		hooks: {
			afterResponse: [({response}) => {
				statuses.push(response.status);
			}],
		},
	});

	t.is(response.status, 200);
	t.is(response.headers.get('x-final'), 'yes');
	t.false(response.headers.has('x-early-only'));
	t.false(response.headers.has('link'));
	t.deepEqual(await response.json(), {final: true});
	t.deepEqual(statuses, [200]);
});

test('duplicate Accept entries retain preference order and quality values', async t => {
	// RFC 9110 §§5.3 and 12.5.1: list order and quality parameters must survive header combination.
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		t.is(request.headers.accept, 'application/problem+json, application/json;q=0.9, */*;q=0.1');
		response.json({negotiated: true});
	});
	const result = await ky(server.url, {
		headers: [
			['Accept', 'application/problem+json'],
			['accept', 'application/json;q=0.9'],
			['ACCEPT', '*/*;q=0.1'],
		],
	}).json();

	t.deepEqual(result, {negotiated: true});
});
