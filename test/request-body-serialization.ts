import {buffer} from 'node:stream/consumers';
import test, {type ExecutionContext} from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

type ReceivedBody = {
	bytes: number[];
	contentType?: string;
	contentLength: string;
};

async function createBodyServer(t: ExecutionContext) {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		response.json({
			bytes: [...await buffer(request)],
			contentType: request.headers['content-type'],
			contentLength: request.headers['content-length'],
		});
	});
	return server;
}

function assertBytes(t: ExecutionContext, received: ReceivedBody, expected: Uint8Array) {
	t.deepEqual(received.bytes, [...expected]);
	t.is(received.contentLength, String(expected.byteLength));
}

// Fetch §5.2 extracts strings as UTF-8 bytes and infers their media type.
// https://fetch.spec.whatwg.org/#concept-bodyinit-extract
for (const [description, body] of [
	['Unicode', 'é日本語🌍'],
	['line endings', 'first\nsecond\rthird\r\nfourth'],
	['empty string', ''],
]) {
	test(`string request body preserves ${description} and uses its byte length`, async t => {
		const server = await createBodyServer(t);
		const received = await ky.post(server.url, {body, retry: 0}).json<ReceivedBody>();
		assertBytes(t, received, Buffer.from(body!));
		t.is(received.contentType, 'text/plain;charset=UTF-8');
	});
}

test('JSON serialization uses UTF-8 byte length including escaped characters', async t => {
	const server = await createBodyServer(t);
	const received = await ky.post(server.url, {json: {message: 'é🌍\n"'}, retry: 0}).json<ReceivedBody>();
	assertBytes(t, received, Buffer.from(String.raw`{"message":"é🌍\n\""}`));
	t.is(received.contentType, 'application/json');
});

test('custom JSON serialization determines the actual bytes and content length', async t => {
	const server = await createBodyServer(t);
	let calls = 0;
	const received = await ky.post(server.url, {
		json: {value: 1},
		stringifyJson(value) {
			calls++;
			t.deepEqual(value, {value: 1});
			return '{ "custom": "日本語" }';
		},
		retry: 0,
	}).json<ReceivedBody>();
	assertBytes(t, received, Buffer.from('{ "custom": "日本語" }'));
	t.is(received.contentType, 'application/json');
	t.is(calls, 1);
});

// Fetch copies BufferSource bytes, respecting a view's byte offset and byte length.
for (const kind of ['ArrayBuffer', 'Uint8Array subarray', 'DataView'] as const) {
	test(`binary request body preserves ${kind} bytes without inventing a media type`, async t => {
		const server = await createBodyServer(t);
		const bytes = new Uint8Array([99, 0, 128, 255, 100]);
		const body = kind === 'ArrayBuffer' ? bytes.buffer : (kind === 'DataView' ? new DataView(bytes.buffer, 1, 3) : bytes.subarray(1, 4));
		const received = await ky.post(server.url, {body, retry: 0}).json<ReceivedBody>();
		assertBytes(t, received, kind === 'ArrayBuffer' ? bytes : new Uint8Array([0, 128, 255]));
		t.is(received.contentType, undefined);
	});
}

test('binary request body is copied before the caller mutates its buffer', async t => {
	const server = await createBodyServer(t);
	const body = new Uint8Array([0, 128, 255]);
	const response = ky.post(server.url, {body, retry: 0});
	body.fill(42);
	assertBytes(t, await response.json<ReceivedBody>(), new Uint8Array([0, 128, 255]));
});

// URL §5.2 serializes ordered pairs, with spaces as + and literal + as %2B.
// https://url.spec.whatwg.org/#concept-urlencoded-serializer
for (const [description, entries, expected] of [
	['spaces, plus signs, Unicode, and reserved characters', [['a b', 'a+b é🌍&=~']], 'a+b=a%2Bb+%C3%A9%F0%9F%8C%8D%26%3D%7E'],
	['repeated names and empty values', [['tag', 'first'], ['tag', ''], ['tag', 'last'], ['', 'empty name']], 'tag=first&tag=&tag=last&=empty+name'],
	['an empty entry list', [], ''],
] as const) {
	test(`URLSearchParams body preserves ${description}`, async t => {
		const server = await createBodyServer(t);
		const body = new URLSearchParams(entries.map(([name, value]) => [name, value]));
		const received = await ky.post(server.url, {body, retry: 0}).json<ReceivedBody>();
		assertBytes(t, received, Buffer.from(expected));
		t.is(received.contentType, 'application/x-www-form-urlencoded;charset=UTF-8');
	});
}

for (const type of ['application/x-binary', '']) {
	test(`Blob body preserves binary bytes with ${type || 'no'} media type`, async t => {
		const server = await createBodyServer(t);
		const bytes = new Uint8Array([0, 13, 10, 128, 255]);
		const received = await ky.post(server.url, {body: new Blob([bytes], {type}), retry: 0}).json<ReceivedBody>();
		assertBytes(t, received, bytes);
		t.is(received.contentType, type || undefined);
	});
}

test('sliced Blob body uses the slice bytes, size, and media type', async t => {
	const server = await createBodyServer(t);
	const body = new Blob([new Uint8Array([99, 0, 128, 255, 100])], {type: 'application/original'}).slice(1, 4, 'application/slice');
	const received = await ky.post(server.url, {body, retry: 0}).json<ReceivedBody>();
	assertBytes(t, received, new Uint8Array([0, 128, 255]));
	t.is(received.contentType, 'application/slice');
});

test('explicit URLSearchParams content type does not change form encoding', async t => {
	const server = await createBodyServer(t);
	const received = await ky.post(server.url, {
		body: new URLSearchParams({message: 'a+b é'}),
		headers: {'content-type': 'application/custom'},
		retry: 0,
	}).json<ReceivedBody>();
	assertBytes(t, received, Buffer.from('message=a%2Bb+%C3%A9'));
	t.is(received.contentType, 'application/custom');
});

// Fetch §5.2 uses multipart/form-data encoding for the FormData entry list.
// HTML §4.10.22.8 preserves duplicate fields and normalizes non-file line endings to CRLF.
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart/form-data-encoding-algorithm
// Parse the bytes actually received by the HTTP server using the transmitted boundary.
for (const description of ['duplicate fields', 'named binary file', 'field line endings'] as const) {
	test(`FormData serialization preserves ${description}`, async t => {
		const server = await createBodyServer(t);
		const body = new FormData();
		if (description === 'duplicate fields') {
			body.append('tag', 'é');
			body.append('tag', '');
			body.append('tag', '🌍');
		} else if (description === 'named binary file') {
			body.append('attachment', new Blob([new Uint8Array([0, 13, 10, 128, 255])], {type: 'application/octet-stream'}), 'sample.bin');
		} else {
			body.append('message', 'first\nsecond\rthird\r\nfourth');
		}

		const received = await ky.post(server.url, {body, retry: 0}).json<ReceivedBody>();
		t.true(received.contentType!.startsWith('multipart/form-data; boundary='));
		t.is(received.contentLength, String(received.bytes.length));
		const parsed = await new Response(new Uint8Array(received.bytes), {headers: {'content-type': received.contentType!}}).formData();
		if (description === 'duplicate fields') {
			t.deepEqual([...parsed], [['tag', 'é'], ['tag', ''], ['tag', '🌍']]);
		} else if (description === 'named binary file') {
			t.deepEqual([...parsed.keys()], ['attachment']);
			const file = parsed.get('attachment') as File;
			t.is(file.name, 'sample.bin');
			t.is(file.type, 'application/octet-stream');
			t.deepEqual([...new Uint8Array(await file.arrayBuffer())], [0, 13, 10, 128, 255]);
		} else {
			t.deepEqual([...parsed], [['message', 'first\r\nsecond\r\nthird\r\nfourth']]);
		}
	});
}
