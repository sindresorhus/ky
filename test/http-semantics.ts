import test from 'ava';
import ky, {HTTPError} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

// RFC 9110 §§9.3.2 and 8.6 allow HEAD to advertise the corresponding GET representation's length without sending content.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2
for (const status of [200, 404]) {
	test(`HEAD ${status} preserves representation headers without consuming a body`, async t => {
		const server = await createHttpTestServer(t);
		let progressCalls = 0;
		let parserCalls = 0;
		server.head('/', (_request, response) => {
			response.writeHead(status, {'content-type': 'application/json', 'content-length': '1234'}).end();
		});
		const request = ky.head(server.url, {
			retry: 0,
			onDownloadProgress() {
				progressCalls++;
			},
			parseJson() {
				parserCalls++;
				return {};
			},
		});
		if (status === 200) {
			const response = await request;
			t.is(response.headers.get('content-length'), '1234');
			t.is(await response.text(), '');
		} else {
			const error = await t.throwsAsync(request, {instanceOf: HTTPError});
			t.is(error.response.status, 404);
			t.is(error.response.headers.get('content-length'), '1234');
			t.is(error.data, undefined);
		}

		t.is(progressCalls, 0);
		t.is(parserCalls, 0);
	});
}

// RFC 9110 §§15.3.5–15.3.6 prohibit content in 204 and 205 responses.
for (const status of [204, 205]) {
	test(`${status} completes without body progress and retains response metadata`, async t => {
		const server = await createHttpTestServer(t);
		server.get('/', (_request, response) => {
			response.writeHead(status, {etag: '"version-2"'}).end();
		});
		let progressCalls = 0;
		const response = await ky(server.url, {
			onDownloadProgress() {
				progressCalls++;
			},
		});

		t.is(response.status, status);
		t.true(response.ok);
		t.is(response.headers.get('etag'), '"version-2"');
		t.is(await response.text(), '');
		t.is(progressCalls, 0);
	});
}

// A 304 has no content; Content-Length may describe the selected representation (RFC 9110 §§15.4.5 and 8.6).
for (const [condition, value] of [
	['if-none-match', '"version-1"'],
	['if-modified-since', 'Wed, 01 Jan 2025 00:00:00 GMT'],
] as const) {
	test(`conditional requests preserve ${condition} and expose bodyless 304 responses`, async t => {
		const server = await createHttpTestServer(t);
		server.get('/', (request, response) => {
			t.is(request.headers[condition], value);
			response.writeHead(304, {etag: '"version-1"', 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT', 'content-length': '42'}).end();
		});
		let progressCalls = 0;
		const response = await ky(server.url, {
			headers: {[condition]: value},
			throwHttpErrors: false,
			onDownloadProgress() {
				progressCalls++;
			},
		});

		t.is(response.status, 304);
		t.false(response.ok);
		t.is(response.headers.get('etag'), '"version-1"');
		t.is(response.headers.get('content-length'), '42');
		t.is(await response.text(), '');
		t.is(progressCalls, 0);
	});
}

test('304 uses the default HTTP error policy without retrying or parsing absent JSON', async t => {
	const server = await createHttpTestServer(t);
	let requests = 0;
	let parserCalls = 0;
	server.get('/', (_request, response) => {
		requests++;
		response.writeHead(304, {etag: '"version-1"', 'content-type': 'application/json'}).end();
	});
	const error = await t.throwsAsync(ky(server.url, {
		headers: {'if-none-match': '"version-1"'},
		parseJson() {
			parserCalls++;
			return {};
		},
	}), {instanceOf: HTTPError});

	t.is(error.response.status, 304);
	t.is(error.data, undefined);
	t.is(requests, 1);
	t.is(parserCalls, 0);
});

// RFC 9110 §§14.4 and 15.3.7: a single-range response carries the selected bytes and their Content-Range.
test('206 preserves byte-range headers and reports progress for the partial representation', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		t.is(request.headers.range, 'bytes=2-5');
		t.is(request.headers['if-range'], '"version-1"');
		response.writeHead(206, {'content-range': 'bytes 2-5/10', 'content-length': '4'}).end('2345');
	});
	const chunks: Uint8Array[] = [];
	const transferred: number[] = [];
	const response = await ky(server.url, {
		headers: {range: 'bytes=2-5', 'if-range': '"version-1"'},
		onDownloadProgress(progress, chunk) {
			chunks.push(chunk);
			transferred.push(progress.transferredBytes);
		},
	});

	t.is(response.status, 206);
	t.true(response.ok);
	t.is(response.headers.get('content-range'), 'bytes 2-5/10');
	t.is(await response.text(), '2345');
	t.is(Buffer.concat(chunks).toString(), '2345');
	t.is(transferred.at(-1), 4);
});

test('416 preserves the unsatisfied Content-Range and error body without retrying', async t => {
	// RFC 9110 §15.5.17 permits Content-Range to indicate the current representation length.
	const server = await createHttpTestServer(t);
	let requests = 0;
	server.get('/', (request, response) => {
		requests++;
		t.is(request.headers.range, 'bytes=100-');
		response.writeHead(416, {'content-range': 'bytes */10', 'content-type': 'text/plain'}).end('Range unavailable');
	});
	const error = await t.throwsAsync(ky(server.url, {headers: {range: 'bytes=100-'}}), {instanceOf: HTTPError});

	t.is(error.response.status, 416);
	t.is(error.response.headers.get('content-range'), 'bytes */10');
	t.is(error.data, 'Range unavailable');
	t.is(requests, 1);
});
