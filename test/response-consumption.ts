import test from 'ava';
import ky, {HTTPError} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const binary = Buffer.from([0, 255, 128, 13, 10, 0, 195, 40]);

// Fetch's Body mixin consumes bytes without text decoding for these methods.
// https://fetch.spec.whatwg.org/#body-mixin
for (const method of ['arrayBuffer', 'blob', 'bytes'] as const) {
	const run = method === 'bytes' && typeof Response.prototype.bytes !== 'function' ? test.skip : test;
	run(`${method} preserves non-text bytes through download progress`, async t => {
		const server = await createHttpTestServer(t);
		server.get('/', (_request, response) => {
			response.set({'content-type': 'application/octet-stream', 'content-length': String(binary.length)}).end(binary);
		});
		const chunks: Uint8Array[] = [];
		let finalTransferred = 0;
		const result = await ky(server.url, {
			onDownloadProgress(progress, chunk) {
				chunks.push(chunk);
				finalTransferred = progress.transferredBytes;
			},
		})[method]();
		if (method === 'blob') {
			t.true(result instanceof Blob);
		} else if (method === 'arrayBuffer') {
			t.true(result instanceof ArrayBuffer);
		} else {
			t.true(result instanceof Uint8Array);
		}

		const bytes = result instanceof Blob ? new Uint8Array(await result.arrayBuffer()) : new Uint8Array(result);
		t.deepEqual(Buffer.from(bytes), binary);
		t.deepEqual(Buffer.concat(chunks), binary);
		t.is(finalTransferred, binary.length);
		if (result instanceof Blob) {
			t.is(result.type, 'application/octet-stream');
			t.is(result.size, binary.length);
		}
	});
}

test('formData parses URL-encoded repeated fields, plus signs, and UTF-8 through progress', async t => {
	const server = await createHttpTestServer(t);
	const text = 'tag=one&tag=two&message=caf%C3%A9+time&literal=%2B&empty=';
	server.get('/', (_request, response) => {
		response.set('content-type', 'application/x-www-form-urlencoded').end(text);
	});
	const chunks: Uint8Array[] = [];
	const form = await ky(server.url, {
		onDownloadProgress(_progress, chunk) {
			chunks.push(chunk);
		},
	}).formData();

	t.deepEqual(form.getAll('tag'), ['one', 'two']);
	t.is(form.get('message'), 'café time');
	t.is(form.get('literal'), '+');
	t.is(form.get('empty'), '');
	t.is(Buffer.concat(chunks).toString(), text);
});

test('formData parses multipart file bytes and repeated fields', async t => {
	const server = await createHttpTestServer(t);
	const form = new FormData();
	form.append('tag', 'one');
	form.append('tag', 'two');
	form.append('file', new Blob([binary], {type: 'application/octet-stream'}), 'sample.bin');
	const encoded = new Response(form);
	const body = Buffer.from(await encoded.arrayBuffer());
	server.get('/', (_request, response) => {
		response.set('content-type', encoded.headers.get('content-type')!).end(body);
	});
	const parsed = await ky(server.url).formData();
	const file = parsed.get('file') as File;

	t.deepEqual(parsed.getAll('tag'), ['one', 'two']);
	t.true(file instanceof File);
	t.is(file.name, 'sample.bin');
	t.is(file.type, 'application/octet-stream');
	t.deepEqual(Buffer.from(await file.arrayBuffer()), binary);
});

test('formData rejects unsupported response media types without retrying', async t => {
	const server = await createHttpTestServer(t);
	let requests = 0;
	server.get('/', (_request, response) => {
		requests++;
		response.set('content-type', 'application/json').end('{}');
	});

	await t.throwsAsync(ky(server.url).formData(), {instanceOf: TypeError});
	t.is(requests, 1);
});

for (const firstMethod of ['text', 'json', 'arrayBuffer'] as const) {
	test(`${firstMethod} shortcut consumes the shared response exactly once`, async t => {
		const server = await createHttpTestServer(t);
		let requests = 0;
		server.get('/', (_request, response) => {
			requests++;
			response.json({value: 42});
		});
		const pending = ky(server.url);
		await pending[firstMethod]();
		const response = await pending;

		t.true(response.bodyUsed);
		await t.throwsAsync(pending.text(), {instanceOf: TypeError});
		t.throws(() => response.clone(), {instanceOf: TypeError});
		t.is(requests, 1);
	});
}

test('redirected progress clones retain metadata and use their own parser response context', async t => {
	const server = await createHttpTestServer(t);
	server.get('/start', (_request, response) => {
		response.redirect('/end');
	});
	server.get('/end', (_request, response) => {
		response.set('x-final', 'yes').json({value: 42});
	});
	const parserResponses: Response[] = [];
	const chunks: Uint8Array[] = [];
	const response = await ky(`${server.url}/start`, {
		parseJson(text, context) {
			parserResponses.push(context.response);
			return JSON.parse(text);
		},
		onDownloadProgress(_progress, chunk) {
			chunks.push(chunk);
		},
	});
	const clone = response.clone().clone();

	t.is(clone.url, `${server.url}/end`);
	t.true(clone.redirected);
	t.is(clone.headers.get('x-final'), 'yes');
	t.deepEqual(await clone.json(), {value: 42});
	t.false(response.bodyUsed);
	t.deepEqual(await response.json(), {value: 42});
	t.is(parserResponses.length, 2);
	t.is(parserResponses[0], clone);
	t.is(parserResponses[1], response);
	t.is(Buffer.concat(chunks).toString(), '{"value":42}');
});

// JSON texts can contain primitive values, including falsy ones (RFC 8259 §3).
// https://www.rfc-editor.org/rfc/rfc8259.html#section-3
for (const value of [false, true, 0, '', ['one', 2]]) {
	test(`JSON value ${JSON.stringify(value)} is preserved in successful and error responses`, async t => {
		const server = await createHttpTestServer(t);
		const text = JSON.stringify(value);
		server.get('/success', (_request, response) => {
			response.set('content-type', 'application/json').end(text);
		});
		server.get('/error', (_request, response) => {
			response.status(422).set('content-type', 'application/json').end(text);
		});

		t.deepEqual(await ky(`${server.url}/success`).json(), value);
		const error = await t.throwsAsync(ky(`${server.url}/error`), {instanceOf: HTTPError});
		t.deepEqual(error.data, value);
	});
}

test('disabling HTTP errors allows consuming a binary error response without JSON parsing', async t => {
	const server = await createHttpTestServer(t);
	let parserCalls = 0;
	server.get('/', (_request, response) => {
		response.status(422).set('content-type', 'application/octet-stream').end(binary);
	});
	const buffer = await ky(server.url, {
		throwHttpErrors: false,
		parseJson() {
			parserCalls++;
			return {};
		},
	}).arrayBuffer();

	t.deepEqual(Buffer.from(buffer), binary);
	t.is(parserCalls, 0);
});

test('formData parsing errors pass through beforeError exactly once without retrying', async t => {
	const server = await createHttpTestServer(t);
	let requests = 0;
	server.get('/', (_request, response) => {
		requests++;
		response.set('content-type', 'application/json').end('{}');
	});
	const replacement = new Error('Unexpected response format');
	let hookCalls = 0;

	await t.throwsAsync(ky(server.url, {
		hooks: {
			beforeError: [({error, request, retryCount}) => {
				hookCalls++;
				t.true(error instanceof TypeError);
				t.is(request.url, `${server.url}/`);
				t.is(retryCount, 0);
				return replacement;
			}],
		},
	}).formData(), {is: replacement});
	t.is(hookCalls, 1);
	t.is(requests, 1);
});

test('beforeError failures while handling body-reader errors propagate without running hooks again', async t => {
	const readError = new Error('Response body could not be read');
	const hookError = new Error('Error handler failed');
	let fetchCalls = 0;
	let hookCalls = 0;

	await t.throwsAsync(ky('https://example.com', {
		async fetch() {
			fetchCalls++;
			return new Response(new ReadableStream({
				start(controller) {
					controller.error(readError);
				},
			}));
		},
		hooks: {
			beforeError: [({error}) => {
				hookCalls++;
				t.is(error, readError);
				throw hookError;
			}],
		},
	}).text(), {is: hookError});

	t.is(fetchCalls, 1);
	t.is(hookCalls, 1);
});
