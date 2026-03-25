import {Buffer} from 'node:buffer';
import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const supportsBytes = typeof (globalThis.Response?.prototype as unknown as {bytes?: unknown})?.bytes === 'function';

test('.bytes() returns Uint8Array when supported', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		t.is(request.headers.accept, '*/*');
		// Send raw binary bytes
		response.end(Buffer.from([0, 1, 2, 255]));
	});

	if (!supportsBytes) {
		await ky(server.url).text();
		t.pass();
		return;
	}

	const bytes = await ky(server.url).bytes();
	t.true(bytes instanceof Uint8Array);
	t.deepEqual([...bytes], [0, 1, 2, 255]);
});

test('.bytes() throws on HTTP errors when supported', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (_request, response) => {
		response.status(400).end('nope');
	});

	if (!supportsBytes) {
		await ky(server.url, {throwHttpErrors: false}).text();
		t.pass();
		return;
	}

	await t.throwsAsync(ky(server.url).bytes(), {message: /Bad Request/});
});
