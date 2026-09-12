import {gzipSync, deflateSync, brotliCompressSync} from 'node:zlib';
import test from 'ava';
import ky, {HTTPError} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const document = {message: 'café 日本語 🌍', detail: 'Repeated content '.repeat(100)};

// Keep chunk boundaries deterministic: HTTP transports may coalesce separate writes.
const byteStream = (bytes: Uint8Array) => {
	let offset = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset === bytes.length) {
				controller.close();
				return;
			}

			controller.enqueue(bytes.slice(offset, ++offset));
		},
	});
};

for (const [encoding, compress] of [
	['gzip', gzipSync],
	['deflate', deflateSync],
	['br', brotliCompressSync],
] as const) {
	test(`${encoding} JSON responses expose decoded bytes to download progress`, async t => {
		const server = await createHttpTestServer(t);
		const text = JSON.stringify(document);
		const compressed = compress(Buffer.from(text));
		server.get('/', (_request, response) => {
			response.set({'content-type': 'application/json', 'content-encoding': encoding, 'content-length': String(compressed.length)});
			response.end(compressed);
		});
		const chunks: Uint8Array[] = [];
		const parsed = await ky(server.url, {
			onDownloadProgress(_progress, chunk) {
				chunks.push(chunk);
			},
		}).json();

		t.deepEqual(parsed, document);
		t.true(chunks.length > 0);
		t.is(Buffer.concat(chunks).toString(), text);
	});

	test(`${encoding} error responses populate decoded JSON data`, async t => {
		const server = await createHttpTestServer(t);
		const compressed = compress(Buffer.from(JSON.stringify(document)));
		server.get('/', (_request, response) => {
			response.status(422).set({'content-type': 'application/problem+json', 'content-encoding': encoding});
			response.end(compressed);
		});
		const error = await t.throwsAsync(ky(server.url, {retry: 0}), {instanceOf: HTTPError});

		t.deepEqual(error.data, document);
		t.is(error.response.status, 422);
		t.true(error.response.bodyUsed);
	});
}

for (const status of [200, 422]) {
	test(`JSON with a split UTF-8 BOM and multibyte characters is decoded at status ${status}`, async t => {
		const body = {message: 'é 日本語 🌍'};
		const options = {
			retry: 0,
			fetch: async () => new Response(byteStream(Buffer.from(`\uFEFF${JSON.stringify(body)}`)), {
				status,
				headers: {'content-type': 'application/json'},
			}),
		};
		if (status === 200) {
			t.deepEqual(await ky('https://example.com', options).json(), body);
		} else {
			const error = await t.throwsAsync(ky('https://example.com', options), {instanceOf: HTTPError});
			t.deepEqual(error.data, body);
		}
	});
}

for (const {title, contentType, bytes, expected} of [
	{
		title: 'UTF-16LE code units and surrogate pairs split between bytes', contentType: 'text/plain; charset=utf-16le', bytes: Buffer.from('é 🌍', 'utf16le'), expected: 'é 🌍',
	},
	{
		title: 'quoted case-insensitive charset labels', contentType: 'text/plain; ChArSeT="WiNdOwS-1252"', bytes: Uint8Array.from([0x80, 0x20, 0xE9]), expected: '€ é',
	},
	{
		title: 'unknown charset fallback', contentType: 'text/plain; charset=unknown-encoding', bytes: Buffer.from('日本語 🌍'), expected: '日本語 🌍',
	},
	{
		title: 'incomplete trailing UTF-8 sequences', contentType: 'text/plain; charset=utf-8', bytes: Uint8Array.from([0x61, 0xE2, 0x82]), expected: 'a\uFFFD',
	},
]) {
	test(`error text decodes ${title}`, async t => {
		const error = await t.throwsAsync(ky('https://example.com', {
			retry: 0,
			fetch: async () => new Response(byteStream(bytes), {status: 400, headers: {'content-type': contentType}}),
		}), {instanceOf: HTTPError});

		t.is(error.data, expected);
	});
}

for (const status of [200, 422]) {
	test(`custom JSON parser receives decoded text and response metadata once at status ${status}`, async t => {
		const server = await createHttpTestServer(t);
		const text = JSON.stringify({message: '日本語 🌍'});
		server.get('/', (_request, response) => {
			response.status(status).set({'content-type': 'application/json', 'content-encoding': 'gzip', 'x-parser-test': 'decoded'});
			response.end(gzipSync(Buffer.from(text)));
		});
		let calls = 0;
		const request = ky(server.url, {
			retry: 0,
			parseJson(decodedText, {request, response}) {
				calls++;
				t.is(decodedText, text);
				t.is(request.url, `${server.url}/`);
				t.is(response.url, `${server.url}/`);
				t.is(response.status, status);
				t.is(response.headers.get('x-parser-test'), 'decoded');
				return {parsed: JSON.parse(decodedText)};
			},
		});
		const expected = {parsed: {message: '日本語 🌍'}};
		if (status === 200) {
			t.deepEqual(await request.json(), expected);
		} else {
			const error = await t.throwsAsync(request, {instanceOf: HTTPError});
			t.deepEqual(error.data, expected);
		}

		t.is(calls, 1);
	});
}

test('error text at the exact 10 MiB limit is retained', async t => {
	const text = 'a'.repeat(10 * 1024 * 1024);
	const error = await t.throwsAsync(ky('https://example.com', {
		retry: 0,
		fetch: async () => new Response(text, {status: 400, headers: {'content-type': 'text/plain'}}),
	}), {instanceOf: HTTPError});

	t.is(error.data, text);
});
