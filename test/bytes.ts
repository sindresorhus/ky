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
	t.true(bytes.buffer instanceof ArrayBuffer);
	t.deepEqual([...bytes], [0, 1, 2, 255]);
	t.deepEqual(new Uint8Array(await new Blob([bytes]).arrayBuffer()), bytes);
	t.deepEqual(new Uint8Array(await new Response(bytes).arrayBuffer()), bytes);
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

// Support is checked on each call rather than when Ky is imported, so a polyfill added later is picked up, also by the promise that reports a setup error.
test.serial('.bytes() is offered only while Response.prototype.bytes exists', async t => {
	const descriptor = Object.getOwnPropertyDescriptor(Response.prototype, 'bytes');
	t.teardown(() => {
		Reflect.deleteProperty(Response.prototype, 'bytes');
		if (descriptor) {
			Object.defineProperty(Response.prototype, 'bytes', descriptor);
		}
	});

	const fetch = async () => new Response('ok');

	Reflect.deleteProperty(Response.prototype, 'bytes');

	const unsupportedPromise = ky('https://example.com', {fetch});
	const unsupportedSetupErrorPromise = ky('https://example.com', {timeout: -1});
	t.false('bytes' in unsupportedPromise);
	t.false('bytes' in unsupportedSetupErrorPromise);
	await t.throwsAsync(unsupportedSetupErrorPromise);
	await unsupportedPromise;

	Object.defineProperty(Response.prototype, 'bytes', {
		configurable: true,
		writable: true,
		async value(this: Response) {
			return new Uint8Array(await this.arrayBuffer());
		},
	});

	const supportedPromise = ky('https://example.com', {fetch});
	const supportedSetupErrorPromise = ky('https://example.com', {timeout: -1});
	t.true('bytes' in supportedPromise);
	t.true('bytes' in supportedSetupErrorPromise);
	await t.throwsAsync(supportedSetupErrorPromise);
	t.deepEqual([...await supportedPromise.bytes()], [111, 107]);
});
