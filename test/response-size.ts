import {gzipSync} from 'node:zlib';
import test from 'ava';
import ky, {
	HTTPError, KyError, ResponseSizeError, isKyError, isResponseSizeError,
} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const url = 'https://example.com/data';

for (const maxResponseSize of [0, 4, Number.POSITIVE_INFINITY]) {
	test(`allows bodies at the limit of ${maxResponseSize} bytes`, async t => {
		const body = maxResponseSize === 0 ? '' : '🦄';
		const text = await ky(url, {
			maxResponseSize,
			fetch: async () => new Response(body),
		}).text();
		t.is(text, body);
	});
}

for (const maxResponseSize of [-1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '4', null]) {
	test(`rejects invalid maxResponseSize: ${String(maxResponseSize)}`, t => {
		t.throws(() => {
			void ky(url, {
				maxResponseSize: maxResponseSize as number,
				async fetch() {
					t.fail('Should validate before fetching');
					return new Response();
				},
			});
		}, {instanceOf: TypeError});
	});
}

test('counts bytes rather than characters and ignores Content-Length', async t => {
	const error = await t.throwsAsync(ky(url, {
		maxResponseSize: 3,
		fetch: async () => new Response('🦄', {headers: {'content-length': '1'}}),
	}).text(), {instanceOf: ResponseSizeError});
	t.is(error?.maxResponseSize, 3);
	t.is(error?.request.url, url);
	t.true(error instanceof KyError);
	t.true(isKyError(error));
	t.true(isResponseSizeError(error));
	t.true(isResponseSizeError({name: 'ResponseSizeError', isKyError: true}));
	t.true(isKyError({name: 'ResponseSizeError', isKyError: true}));
	t.false(isResponseSizeError(new Error('Unrelated error')));
});

test('does not reject a body within the limit based on Content-Length', async t => {
	const text = await ky(url, {
		maxResponseSize: 4,
		fetch: async () => new Response('okay', {headers: {'content-length': '1000'}}),
	}).text();
	t.is(text, 'okay');
});

test('does not reject an empty HEAD body based on Content-Length', async t => {
	const response = await ky.head(url, {
		maxResponseSize: 0,
		fetch: async () => new Response(null, {headers: {'content-length': '1000'}}),
	});
	t.is(await response.text(), '');
});

test('cancels the source when cumulative streamed bytes exceed the limit', async t => {
	let canceledWith: unknown;
	let chunkCount = 0;
	const response = await ky(url, {
		maxResponseSize: 4,
		fetch: async () => new Response(new ReadableStream<Uint8Array>({
			pull(controller) {
				chunkCount++;
				controller.enqueue(new Uint8Array([1, 2]));
			},
			cancel(reason) {
				canceledWith = reason;
			},
		})),
	});
	const reader = response.body!.getReader();
	const first = await reader.read();
	const second = await reader.read();
	t.deepEqual(first.value, new Uint8Array([1, 2]));
	t.deepEqual(second.value, new Uint8Array([1, 2]));
	const error = await t.throwsAsync(reader.read(), {instanceOf: ResponseSizeError});
	await new Promise(resolve => {
		setImmediate(resolve);
	});
	t.is(canceledWith, error);
	t.true(chunkCount <= 4);
});

for (const method of ['json', 'text', 'arrayBuffer', 'blob', 'formData', 'bytes'] as const) {
	test(`limits the ${method} shortcut and runs beforeError once`, async t => {
		if (method === 'bytes' && typeof Response.prototype.bytes !== 'function') {
			t.pass();
			return;
		}

		let errorCount = 0;
		let fetchCount = 0;
		const error = await t.throwsAsync(ky(url, {
			maxResponseSize: 1,
			retry: {shouldRetry: () => true},
			async fetch() {
				fetchCount++;
				return new Response('a=1', {headers: {'content-type': 'application/x-www-form-urlencoded'}});
			},
			hooks: {
				beforeError: [({error}) => {
					errorCount++;
					return error;
				}],
			},
		})[method](), {instanceOf: ResponseSizeError});
		t.true(isResponseSizeError(error));
		t.is(errorCount, 1);
		t.is(fetchCount, 1);
	});
}

test('body reads after the response is returned do not run beforeError', async t => {
	let errorCount = 0;
	const response = await ky(url, {
		maxResponseSize: 1,
		fetch: async () => new Response('oversized'),
		hooks: {
			beforeError: [({error}) => {
				errorCount++;
				return error;
			}],
		},
	});

	await t.throwsAsync(response.text(), {instanceOf: ResponseSizeError});
	t.is(errorCount, 0);
});

test('limits afterResponse hook reads before cloning can buffer an oversized body', async t => {
	let errorCount = 0;
	await t.throwsAsync(ky(url, {
		maxResponseSize: 1,
		fetch: async () => new Response('oversized'),
		hooks: {
			afterResponse: [async ({response}) => {
				await response.clone().text();
			}],
			beforeError: [({error}) => {
				errorCount++;
				return error;
			}],
		},
	}), {instanceOf: ResponseSizeError});
	t.is(errorCount, 1);
});

for (const hook of ['beforeRequest', 'beforeRetry', 'afterResponse'] as const) {
	test(`limits responses returned by ${hook}`, async t => {
		await t.throwsAsync(ky(url, {
			maxResponseSize: 1,
			retry: {delay: () => 0},
			fetch: async () => new Response('', {status: hook === 'beforeRetry' ? 503 : 200}),
			hooks: {
				[hook]: [() => new Response('oversized')],
			},
		}).text(), {instanceOf: ResponseSizeError});
	});
}

test('limits replacement bodies before subsequent afterResponse hooks', async t => {
	await t.throwsAsync(ky(url, {
		maxResponseSize: 1,
		fetch: async () => new Response('a'),
		hooks: {
			afterResponse: [
				() => new Response('oversized'),
				async ({response}) => {
					await response.text();
				},
			],
		},
	}), {instanceOf: ResponseSizeError});
});

test('HTTP error body size failures are not swallowed or retried', async t => {
	let fetchCount = 0;
	let errorCount = 0;
	await t.throwsAsync(ky(url, {
		maxResponseSize: 1,
		retry: {shouldRetry: () => true, delay: () => 0},
		async fetch() {
			fetchCount++;
			return new Response('oversized', {status: 503});
		},
		hooks: {
			beforeError: [({error}) => {
				t.true(error instanceof ResponseSizeError);
				errorCount++;
				return error;
			}],
		},
	}), {instanceOf: ResponseSizeError});
	t.is(fetchCount, 1);
	t.is(errorCount, 1);
});

test('HTTP error bodies within the limit retain their data', async t => {
	const error = await t.throwsAsync(ky(url, {
		maxResponseSize: 3,
		fetch: async () => new Response('bad', {status: 400}),
	}), {instanceOf: HTTPError});
	t.is(error?.data, 'bad');
});

test('a response wrapper retains metadata, clones, and custom JSON parsing', async t => {
	const server = await createHttpTestServer(t);
	server.get('/redirect', (_request, response) => {
		response.redirect('/data');
	});
	server.get('/data', (_request, response) => {
		response.json({value: 1});
	});
	const response = await ky(`${server.url}/redirect`, {
		maxResponseSize: 100,
		parseJson: text => ({...JSON.parse(text), parsed: true}),
	});
	const clone = response.clone();
	t.is(response.url, `${server.url}/data`);
	t.true(response.redirected);
	t.is(clone.url, response.url);
	t.is(clone.type, response.type);
	t.true(clone.redirected);
	t.deepEqual(await clone.json(), {value: 1, parsed: true});
	t.deepEqual(await response.json(), {value: 1, parsed: true});
});

test('limits decompressed response bytes', async t => {
	const server = await createHttpTestServer(t);
	const body = 'a'.repeat(1000);
	const compressed = gzipSync(body);
	t.true(compressed.byteLength < 100);
	server.get('/', (_request, response) => {
		response.set('content-encoding', 'gzip').send(compressed);
	});
	await t.throwsAsync(ky(server.url, {maxResponseSize: 100}).text(), {instanceOf: ResponseSizeError});
});

test('combines with download progress', async t => {
	const sizes: number[] = [];
	const api = ky.create({
		maxResponseSize: 4,
		fetch: async () => new Response('test'),
		onDownloadProgress({transferredBytes}) {
			sizes.push(transferredBytes);
		},
	});
	t.is(await api(url).text(), 'test');
	t.is(sizes.at(-1), 4);
	await t.throwsAsync(api(url, {maxResponseSize: 3}).text(), {instanceOf: ResponseSizeError});
});

test('does not report completed download progress when the size limit is exceeded', async t => {
	const maxResponseSize = 4;
	let reportedBytes = 0;
	await t.throwsAsync(ky(url, {
		maxResponseSize,
		fetch: async () => new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
				controller.enqueue(new Uint8Array([3, 4]));
				controller.enqueue(new Uint8Array([5, 6]));
				controller.close();
			},
		})),
		onDownloadProgress({percent, transferredBytes}, chunk) {
			reportedBytes += chunk.byteLength;
			t.is(transferredBytes, reportedBytes);
			t.true(transferredBytes <= maxResponseSize);
			t.true(percent < 1);
		},
	}).arrayBuffer(), {instanceOf: ResponseSizeError});
	t.true(reportedBytes > 0);
});

test('defaults to unlimited and allows overriding an inherited limit', async t => {
	const api = ky.create({fetch: async () => new Response('test')});
	t.is(await api(url).text(), 'test');
	const limited = api.extend({maxResponseSize: 1});
	await t.throwsAsync(limited(url).text(), {instanceOf: ResponseSizeError});
	t.is(await limited(url, {maxResponseSize: Number.POSITIVE_INFINITY}).text(), 'test');
});

test('a zero limit rejects a nonempty body', async t => {
	await t.throwsAsync(ky(url, {
		maxResponseSize: 0,
		fetch: async () => new Response(new Uint8Array([0])),
	}).arrayBuffer(), {instanceOf: ResponseSizeError});
});

test('counts chunk view lengths and accepts multiple chunks exactly at the limit', async t => {
	const buffer = new Uint8Array(1024).fill(255);
	buffer.set([1, 2, 3, 4], 100);
	const body = await ky(url, {
		maxResponseSize: 4,
		fetch: async () => new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(buffer.subarray(100, 102));
				controller.enqueue(new Uint8Array());
				controller.enqueue(buffer.subarray(102, 104));
				controller.close();
			},
		})),
	}).arrayBuffer();
	t.deepEqual(new Uint8Array(body), new Uint8Array([1, 2, 3, 4]));
});

for (const forced of [false, true]) {
	test(`resets the byte count for ${forced ? 'forced' : 'HTTP'} retries`, async t => {
		let fetchCount = 0;
		const text = await ky(url, {
			maxResponseSize: 4,
			retry: {limit: 1, delay: () => 0},
			async fetch() {
				fetchCount++;
				return new Response(fetchCount === 1 ? 'fail' : 'done', {
					status: !forced && fetchCount === 1 ? 503 : 200,
				});
			},
			hooks: {
				afterResponse: [async ({response, retryCount}) => {
					if (forced && retryCount === 0) {
						t.is(await response.text(), 'fail');
						return ky.retry();
					}
				}],
			},
		}).text();
		t.is(text, 'done');
		t.is(fetchCount, 2);
	});
}

test('concurrent requests on one instance have independent byte counts and errors', async t => {
	const api = ky.create({
		maxResponseSize: 4,
		fetch: async request => new Response(new URL((request as Request).url).pathname === '/large' ? 'large' : 'okay'),
	});
	const results = await Promise.allSettled([
		api('https://example.com/large').text(),
		api('https://example.com/small').text(),
	]);
	const [large, small] = results;
	t.is(large.status, 'rejected');
	if (large.status === 'rejected') {
		t.true(large.reason instanceof ResponseSizeError);
		t.is((large.reason as ResponseSizeError).request.url, 'https://example.com/large');
	}

	t.deepEqual(small, {status: 'fulfilled', value: 'okay'});
	t.is(await api('https://example.com/small').text(), 'okay');
});

test('rejects an oversized JSON body before calling a custom parser', async t => {
	let parseCount = 0;
	await t.throwsAsync(ky(url, {
		maxResponseSize: 4,
		fetch: async () => Response.json({value: 1}),
		parseJson(text) {
			parseCount++;
			return JSON.parse(text);
		},
	}).json(), {instanceOf: ResponseSizeError});
	t.is(parseCount, 0);
});

test('preserves custom parser errors for bodies within the limit', async t => {
	const parseError = new Error('Custom parser failed');
	const response = await ky(url, {
		maxResponseSize: 4,
		fetch: async () => new Response('null'),
		parseJson() {
			throw parseError;
		},
	});
	await t.throwsAsync(response.clone().json(), {is: parseError});
	await t.throwsAsync(response.json(), {is: parseError});
});

test('preserves source stream errors instead of reporting a size failure', async t => {
	const streamError = new Error('Source stream failed');
	await t.throwsAsync(ky(url, {
		maxResponseSize: 4,
		fetch: async () => new Response(new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(streamError);
			},
		})),
	}).text(), {is: streamError});
});

test('allows beforeError to replace the size error without running twice', async t => {
	const replacementError = new Error('Response rejected by application');
	let errorCount = 0;
	await t.throwsAsync(ky(url, {
		maxResponseSize: 1,
		fetch: async () => new Response('large'),
		hooks: {
			beforeError: [({error}) => {
				t.true(error instanceof ResponseSizeError);
				errorCount++;
				return replacementError;
			}],
		},
	}).text(), {is: replacementError});
	t.is(errorCount, 1);
});

test('size errors refer to the replacement request from beforeRequest', async t => {
	const replacement = new Request('https://example.com/replacement', {method: 'POST'});
	const error = await t.throwsAsync(ky(url, {
		maxResponseSize: 1,
		fetch: async () => new Response('large'),
		hooks: {
			beforeRequest: [() => replacement],
		},
	}).text(), {instanceOf: ResponseSizeError});
	t.is(error?.request.url, replacement.url);
	t.is(error?.request.method, 'POST');
});

test('returns a streaming response before completion and forwards caller cancellation', async t => {
	t.timeout(2000);
	const cancellation = Promise.withResolvers<unknown>();
	const response = await ky(url, {
		maxResponseSize: 4,
		fetch: async () => new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
				// Leave the stream open to verify Ky does not wait for the whole body.
			},
			cancel(reason) {
				cancellation.resolve(reason);
			},
		})),
	});
	const reader = response.body!.getReader();
	const chunk = await reader.read();
	t.deepEqual(chunk, {done: false, value: new Uint8Array([1, 2])});
	await reader.cancel('No more data needed');
	t.is(await cancellation.promise, 'No more data needed');
});

// Chromium and WebKit expose an empty body stream on responses whose status forbids a body, even though the `Response` constructor rejects such a body.
for (const status of [101, 103, 204, 205, 304]) {
	test(`passes through a browser-style empty body stream with status ${status}`, async t => {
		let progressCallCount = 0;
		const response = await ky(url, {
			maxResponseSize: 1,
			throwHttpErrors: false,
			onDownloadProgress() {
				progressCallCount++;
			},
			async fetch() {
				const emptyResponse = new Response(new ReadableStream({
					start(controller) {
						controller.close();
					},
				}), {headers: {'x-ky-header': 'ky'}});
				Object.defineProperty(emptyResponse, 'status', {value: status});
				return emptyResponse;
			},
		});

		t.is(response.status, status);
		t.is(response.headers.get('x-ky-header'), 'ky');
		t.is(await response.text(), '');
		t.is(progressCallCount, 0);
	});
}

// Wrapping a body that a hook already read fails with \"The ReadableStream is locked\", which names neither the real mistake nor the option that caused it. The native \"Body is unusable\" error is far clearer, so the wrappers skip an already consumed body instead of crashing inside `pipeThrough()`.
for (const [label, options] of [
	['without the limit', {}],
	['with `maxResponseSize`', {maxResponseSize: 1000}],
	[
		'with `onDownloadProgress`',
		{
			// Only the option's presence matters here.
			onDownloadProgress: () => undefined,
		},
	],
] as Array<[string, Record<string, unknown>]>) {
	test(`an afterResponse hook that returns a consumed response reports the native error ${label}`, async t => {
		const response = await ky(url, {
			...options,
			fetch: async () => new Response('x'.repeat(50)),
			hooks: {
				afterResponse: [async ({response}) => {
					await response.text();
					return response;
				}],
			},
		});

		await t.throwsAsync(response.text(), {
			name: 'TypeError',
			message: 'Body is unusable: Body has already been read',
		});
	});
}

// A reader taken with `getReader()` but never read leaves `bodyUsed` false, so the guard missed it and `pipeThrough()` failed with an error that names neither the mistake nor the option.
for (const [label, options] of [
	['with `maxResponseSize`', {maxResponseSize: 1000}],
	[
		'with `onDownloadProgress`',
		{
			// Only the option's presence matters here.
			onDownloadProgress: () => undefined,
		},
	],
] as Array<[string, Record<string, unknown>]>) {
	test(`a body that is only locked reports the native error ${label}`, async t => {
		const response = await ky(url, {
			...options,
			async fetch() {
				const result = new Response('x'.repeat(50));
				result.body!.getReader();
				return result;
			},
		});

		await t.throwsAsync(response.text(), {
			name: 'TypeError',
			message: 'Body is unusable: Body has already been read',
		});
	});
}

// `new Response(body, response)` rebuilds the header list under the mutable "response" guard, so a network response that arrived immutable became mutable as soon as one of these options was set.
for (const [label, options] of [
	['with `maxResponseSize`', {maxResponseSize: 1000}],
	['with `onDownloadProgress`', {onDownloadProgress: () => undefined}],
] as Array<[string, Record<string, unknown>]>) {
	test(`response headers stay immutable ${label}`, async t => {
		const server = await createHttpTestServer(t);
		server.get('/', (_request, response) => {
			response.set('content-type', 'text/plain').end('payload');
		});

		const response = await ky(server.url, options);
		t.true(response.headers.get('content-type')!.startsWith('text/plain'));
		t.throws(() => {
			response.headers.set('x-injected', '1');
		}, {instanceOf: TypeError});
	});
}

test('response headers stay immutable without the wrapping options', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('payload');
	});

	const response = await ky(server.url);
	t.throws(() => {
		response.headers.set('x-injected', '1');
	}, {instanceOf: TypeError});
});

// Decoration assigns to the response, so a frozen one throws. The caller then gets the error and never receives
// the response, which left its body with nobody able to release it.
test('a response that cannot be decorated releases its body', async t => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('{"a":1}'));
		},
		cancel() {
			cancelled = true;
		},
	});

	const error = await t.throwsAsync(ky(url, {
		retry: 0,
		parseJson: (text: string) => JSON.parse(text),
		fetch: async () => Object.freeze(new Response(body, {headers: {'content-type': 'application/json'}})),
	}).json(), {
		name: 'TypeError',
		message: /not extensible/,
	});

	t.is(error?.name, 'TypeError');
	await new Promise(resolve => {
		setTimeout(resolve, 10);
	});
	t.true(cancelled, 'the response body must be released');
});
