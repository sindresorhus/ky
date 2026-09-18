import test from 'ava';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test.serial('request streams are used in runtimes that do not read the duplex option', async t => {
	const OriginalRequest = globalThis.Request;
	// Bun and Deno accept streaming bodies without ever reading `duplex`, so the constructor looks the same as in WebKit, which cannot upload streams.
	globalThis.Request = class extends OriginalRequest {
		constructor(input: RequestInfo | URL, options?: RequestInit) {
			if (options?.body instanceof ReadableStream) {
				const copiedOptions: Record<string, unknown> = {};
				for (const key of Object.keys(options)) {
					if (key !== 'duplex') {
						copiedOptions[key] = options[key as keyof RequestInit];
					}
				}

				super(input, {...copiedOptions, duplex: 'half'} as RequestInit);
				return;
			}

			super(input, options);
		}
	};
	(globalThis as Record<string, unknown>).Deno = {};
	t.teardown(() => {
		globalThis.Request = OriginalRequest;
		delete (globalThis as Record<string, unknown>).Deno;
	});

	const {default: ky} = await import('../source/index.js');
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', (request, response) => {
		request.pipe(response);
	});

	let progressCallCount = 0;
	t.is(await ky.post(server.url, {
		body: 'payload',
		retry: 0,
		onUploadProgress() {
			progressCallCount++;
		},
	}).text(), 'payload');
	t.true(progressCallCount > 0);

	const input = new Request(server.url, {method: 'POST', body: 'from request'});
	t.is(await ky(input, {searchParams: {q: 1}, retry: 0}).text(), 'from request');
});
