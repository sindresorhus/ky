import test from 'ava';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test.serial('unsupported request streams do not prevent ordinary requests', async t => {
	const OriginalRequest = globalThis.Request;
	let streamProbeCount = 0;
	globalThis.Request = class extends OriginalRequest {
		constructor(input: RequestInfo | URL, options?: RequestInit) {
			if (options?.body instanceof ReadableStream) {
				streamProbeCount++;
				throw new TypeError('Streaming request bodies are not supported');
			}

			super(input, options);
		}
	};
	t.teardown(() => {
		globalThis.Request = OriginalRequest;
	});

	const {default: ky} = await import('../source/index.js');
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('success');
	});
	server.post('/', (request, response) => {
		response.end(request.body);
	});

	let progressCallCount = 0;
	const api = ky.create({
		retry: 0,
		onUploadProgress() {
			progressCallCount++;
		},
	});

	t.is(await api.get(server.url).text(), 'success');
	t.is(await api.post(server.url, {body: 'payload'}).text(), 'payload');
	t.is(streamProbeCount, 1);
	t.is(progressCallCount, 0);
});
