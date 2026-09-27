import test, {type ExecutionContext} from 'ava';
import ky, {isNetworkError, type Progress} from '../source/index.js';
import {createLargeBlob} from './helpers/create-large-file.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';
import {parseRawBody, parseJsonBody} from './helpers/parse-body.js';

test('extending with undefined progress callbacks disables inherited tracking', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		response.end(await parseRawBody(request));
	});

	const instance = ky.create({
		onUploadProgress() {
			throw new Error('Inherited onUploadProgress must not run');
		},
		onDownloadProgress() {
			throw new Error('Inherited onDownloadProgress must not run');
		},
	}).extend({onUploadProgress: undefined, onDownloadProgress: undefined});

	t.is(await instance.post(server.url, {body: 'payload'}).text(), 'payload');
});

test('empty request body completes upload progress', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		response.json({body: await parseRawBody(request)});
	});

	const progressEvents: Array<{progress: Progress; chunk: Uint8Array}> = [];
	const response = await ky
		.post(server.url, {
			body: '',
			onUploadProgress(progress, chunk) {
				progressEvents.push({progress, chunk});
			},
		})
		.json<{body: string}>();

	t.is(response.body, '');
	t.deepEqual(progressEvents, [{
		progress: {percent: 1, totalBytes: 0, transferredBytes: 0},
		chunk: new Uint8Array(),
	}]);
});

for (const retryLimit of [0, 1]) {
	test(`upload progress preserves referrer options with retry limit ${retryLimit}`, async t => {
		const referrer = 'https://example.com/source';
		const referrerPolicy = 'no-referrer';
		const requests: Array<{referrer: string; referrerPolicy: string}> = [];
		let completedUploads = 0;

		const result = await ky.post('https://example.com', {
			body: 'payload',
			referrer,
			referrerPolicy,
			retry: {limit: retryLimit, methods: ['post'], delay: () => 0},
			async fetch(request) {
				requests.push({referrer: request.referrer, referrerPolicy: request.referrerPolicy});
				t.is(await request.text(), 'payload');
				return new Response('ok', {status: requests.length <= retryLimit ? 500 : 200});
			},
			onUploadProgress(progress) {
				if (progress.percent === 1) {
					completedUploads++;
				}
			},
		}).text();

		t.is(result, 'ok');
		t.is(completedUploads, retryLimit + 1);
		t.deepEqual(requests, Array.from({length: retryLimit + 1}, () => ({referrer, referrerPolicy})));
	});
}

for (const [name, options] of [
	['keepalive', {keepalive: true}],
	['no-cors', {mode: 'no-cors'}],
] as const) {
	test(`upload progress does not prevent ${name} requests`, async t => {
		const server = await createHttpTestServer(t, {bodyParser: false});
		server.post('/', async (request, response) => {
			response.end(await parseRawBody(request));
		});

		let progressCalls = 0;
		const result = await ky.post(server.url, {
			...options,
			body: 'payload',
			onUploadProgress() {
				progressCalls++;
			},
		}).text();

		t.is(result, 'payload');
		t.is(progressCalls, 0);
	});
}

test('POST JSON with upload progress', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		response.json(await parseRawBody(request));
	});

	const json = {test: 'test'};
	const data: Progress[] = [];
	const chunks: string[] = [];
	const responseJson = await ky
		.post(server.url, {
			json,
			onUploadProgress(progress, chunk) {
				data.push(progress);
				chunks.push(new TextDecoder().decode(chunk));
			},
		})
		.json();

	// Check if we have at least two progress updates
	t.true(data.length > 0, 'Should have at least one progress update');
	t.deepEqual(
		chunks,
		[
			'{"test":"test"}',
		],
		'Should have chunks for all events',
	);

	// Check the first progress update
	t.true(
		data[0].percent >= 0 && data[0].percent <= 1,
		'First update should have progress between 0 and 100%',
	);
	t.true(
		data[0].transferredBytes >= 0,
		'First update should have non-negative transferred bytes',
	);

	// Check intermediate updates (if any)
	for (let i = 1; i < data.length - 1; i++) {
		t.true(
			data[i].percent >= data[i - 1].percent,
			`Update ${i} should have higher or equal percent than previous`,
		);
		t.true(
			data[i].transferredBytes >= data[i - 1].transferredBytes,
			`Update ${i} should have more or equal transferred bytes than previous`,
		);
	}

	// Check the last progress update
	const lastUpdate = data.at(-1);
	t.is(lastUpdate.percent, 1, 'Last update should have 100% progress');
	t.true(
		lastUpdate.totalBytes > 0,
		'Last update should have positive total bytes',
	);
	t.is(
		lastUpdate.transferredBytes,
		lastUpdate.totalBytes,
		'Last update should have transferred all bytes',
	);
});

test('multiple beforeRequest Request hooks do not duplicate upload progress events', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		response.json(await parseJsonBody<Record<string, unknown>>(request));
	});

	let completedUploadProgressEvents = 0;
	const payload = {test: 'test'};
	const responseJson = await ky
		.post(server.url, {
			json: payload,
			hooks: {
				beforeRequest: [
					({request}) => {
						const headers = new Headers(request.headers);
						headers.set('x-hook-1', 'hook-1');
						return new Request(request, {headers});
					},
					({request}) => {
						const headers = new Headers(request.headers);
						headers.set('x-hook-2', 'hook-2');
						return new Request(request, {headers});
					},
				],
			},
			onUploadProgress(progress) {
				if (progress.percent === 1) {
					completedUploadProgressEvents++;
				}
			},
		})
		.json<Record<string, unknown>>();

	t.deepEqual(responseJson, payload);
	t.is(completedUploadProgressEvents, 1);
});

test('multiple beforeRequest Request hooks do not duplicate upload progress events across retries', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	let requestCount = 0;
	server.post('/', async (request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.status(500).json({error: 'retry'});
			return;
		}

		response.json(await parseJsonBody<Record<string, unknown>>(request));
	});

	const completedUploadProgressEventsPerAttempt: number[] = [0];
	const payload = {test: 'retry'};
	const responseJson = await ky
		.post(server.url, {
			json: payload,
			retry: {
				limit: 1,
				methods: ['post'],
			},
			hooks: {
				beforeRequest: [
					({request}) => {
						const headers = new Headers(request.headers);
						headers.set('x-hook-1', 'hook-1');
						return new Request(request, {headers});
					},
					({request}) => {
						const headers = new Headers(request.headers);
						headers.set('x-hook-2', 'hook-2');
						return new Request(request, {headers});
					},
				],
				beforeRetry: [
					() => {
						completedUploadProgressEventsPerAttempt.push(0);
					},
				],
			},
			onUploadProgress(progress) {
				if (progress.percent !== 1) {
					return;
				}

				const currentAttemptIndex = completedUploadProgressEventsPerAttempt.length - 1;
				completedUploadProgressEventsPerAttempt[currentAttemptIndex]++;
			},
		})
		.json<Record<string, unknown>>();

	t.deepEqual(responseJson, payload);
	t.deepEqual(completedUploadProgressEventsPerAttempt, [1, 1]);
});

test('beforeRequest Request replacement preserves upload progress sizing', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		let totalBytes = 0;
		for await (const chunk of request) {
			totalBytes += chunk.length as number;
		}

		response.json({receivedBytes: totalBytes});
	});

	const largeBlob = createLargeBlob(10);
	const progressEvents: Progress[] = [];
	const response = await ky
		.post(server.url, {
			body: largeBlob,
			hooks: {
				beforeRequest: [
					({request}) => {
						const headers = new Headers(request.headers);
						headers.set('x-hook', '1');
						return new Request(request, {headers});
					},
				],
			},
			onUploadProgress(progress) {
				progressEvents.push(progress);
			},
		})
		.json<{receivedBytes: number}>();

	t.true(progressEvents.length >= 2, 'Should produce multiple progress events');
	const nonFinalProgressEvents = progressEvents.filter(progress => progress.percent < 1);
	t.true(nonFinalProgressEvents.length > 0, 'Should include non-final progress events');
	for (const progress of nonFinalProgressEvents) {
		const expectedPercent = progress.transferredBytes / largeBlob.size;
		t.true(progress.percent <= expectedPercent + 0.01, 'Intermediate progress should reflect known body size');
	}

	const finalProgress = progressEvents.at(-1);
	t.truthy(finalProgress);
	t.is(finalProgress!.percent, 1);
	t.true(finalProgress!.totalBytes > 1024 * 1024);
	t.is(finalProgress!.totalBytes, finalProgress!.transferredBytes);
	t.is(response.receivedBytes, finalProgress!.totalBytes);
});

test('beforeRequest Request replacement with new body preserves upload progress sizing', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		let receivedBytes = 0;
		for await (const chunk of request) {
			receivedBytes += chunk.length as number;
		}

		response.json({receivedBytes});
	});

	const payload = {initial: true};
	const replacementBody = createLargeBlob(10);
	const progressEvents: Progress[] = [];
	const response = await ky
		.post(server.url, {
			json: payload,
			hooks: {
				beforeRequest: [
					({request}) => new Request(request, {body: replacementBody}),
				],
			},
			onUploadProgress(progress) {
				progressEvents.push(progress);
			},
		})
		.json<{receivedBytes: number}>();

	t.true(progressEvents.length > 0, 'Should produce progress events');
	const expectedSize = replacementBody.size;
	const finalProgress = progressEvents.at(-1);
	t.truthy(finalProgress);
	t.is(finalProgress!.percent, 1);
	t.is(finalProgress!.totalBytes, expectedSize);
	t.is(finalProgress!.transferredBytes, expectedSize);
	t.is(response.receivedBytes, expectedSize);
});

test('missing content-length still uses original body size for upload progress', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		let receivedBytes = 0;
		for await (const chunk of request) {
			receivedBytes += chunk.length as number;
		}

		response.json({receivedBytes});
	});

	const body = createLargeBlob(10);
	const progressEvents: Progress[] = [];
	const response = await ky
		.post(server.url, {
			body,
			hooks: {
				beforeRequest: [
					({request}) => {
						request.headers.delete('content-length');
					},
				],
			},
			onUploadProgress(progress) {
				progressEvents.push(progress);
			},
		})
		.json<{receivedBytes: number}>();

	t.true(progressEvents.length >= 2, 'Should produce multiple progress events');
	const nonFinalProgressEvents = progressEvents.filter(progress => progress.percent < 1);
	t.true(nonFinalProgressEvents.length > 0, 'Should include non-final progress events');
	t.true(nonFinalProgressEvents[0].percent > 0, 'Non-final progress should use known total size');

	const finalProgress = progressEvents.at(-1);
	t.truthy(finalProgress);
	t.is(finalProgress!.percent, 1);
	t.is(finalProgress!.totalBytes, body.size);
	t.is(finalProgress!.transferredBytes, body.size);
	t.is(response.receivedBytes, body.size);
});

test('beforeRequest replacement with smaller body completes upload progress correctly', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		let receivedBytes = 0;
		for await (const chunk of request) {
			receivedBytes += chunk.length as number;
		}

		response.json({receivedBytes});
	});

	const originalBody = createLargeBlob(10);
	const replacementBody = 'small-body';
	const replacementBodySize = Buffer.byteLength(replacementBody);
	const progressEvents: Progress[] = [];
	const response = await ky
		.post(server.url, {
			body: originalBody,
			hooks: {
				beforeRequest: [
					({request}) => new Request(request, {body: replacementBody}),
				],
			},
			onUploadProgress(progress) {
				progressEvents.push(progress);
			},
		})
		.json<{receivedBytes: number}>();

	t.true(progressEvents.length > 0, 'Should produce progress events');
	const nonFinalProgressEvents = progressEvents.filter(progress => progress.percent < 1);
	for (const progress of nonFinalProgressEvents) {
		t.true(progress.percent < 1, 'Intermediate progress should stay below completion');
	}

	const finalProgress = progressEvents.at(-1);
	t.truthy(finalProgress);
	t.is(finalProgress!.percent, 1);
	t.is(finalProgress!.transferredBytes, replacementBodySize);
	t.is(response.receivedBytes, replacementBodySize);
});

test('beforeRequest replacement with larger body has monotonic upload progress', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		let receivedBytes = 0;
		for await (const chunk of request) {
			receivedBytes += chunk.length as number;
		}

		response.json({receivedBytes});
	});

	const replacementBody = createLargeBlob(10);
	const progressEvents: Progress[] = [];
	const response = await ky
		.post(server.url, {
			body: 'tiny',
			hooks: {
				beforeRequest: [
					({request}) => new Request(request, {body: replacementBody}),
				],
			},
			onUploadProgress(progress) {
				progressEvents.push(progress);
			},
		})
		.json<{receivedBytes: number}>();

	t.true(progressEvents.length > 0, 'Should produce progress events');
	for (let index = 1; index < progressEvents.length; index++) {
		t.true(progressEvents[index].transferredBytes >= progressEvents[index - 1].transferredBytes, 'Transferred bytes should be monotonic');
		t.true(progressEvents[index].percent >= progressEvents[index - 1].percent, 'Percent should be monotonic');
	}

	const finalProgress = progressEvents.at(-1);
	t.truthy(finalProgress);
	t.is(finalProgress!.percent, 1);
	t.is(finalProgress!.transferredBytes, replacementBody.size);
	t.is(response.receivedBytes, replacementBody.size);
});

test('beforeRequest body replacement followed by header hook keeps progress and headers', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		let receivedBytes = 0;
		for await (const chunk of request) {
			receivedBytes += chunk.length as number;
		}

		response.json({
			receivedBytes,
			header: request.headers['x-hook-2'],
		});
	});

	const replacementBody = 'hook-replacement-body';
	const replacementBodySize = Buffer.byteLength(replacementBody);
	const progressEvents: Progress[] = [];
	const response = await ky
		.post(server.url, {
			body: createLargeBlob(10),
			hooks: {
				beforeRequest: [
					({request}) => new Request(request, {body: replacementBody}),
					({request}) => {
						const headers = new Headers(request.headers);
						headers.set('x-hook-2', 'true');
						return new Request(request, {headers});
					},
				],
			},
			onUploadProgress(progress) {
				progressEvents.push(progress);
			},
		})
		.json<{receivedBytes: number; header: string | undefined}>();

	const finalProgress = progressEvents.at(-1);
	t.truthy(finalProgress);
	t.is(finalProgress!.percent, 1);
	t.is(finalProgress!.transferredBytes, replacementBodySize);
	t.is(response.receivedBytes, replacementBodySize);
	t.is(response.header, 'true');
});

test('retry with beforeRequest body changes tracks per-attempt upload progress', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	let requestCount = 0;
	server.post('/', async (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.status(500).json({error: 'retry'});
			return;
		}

		response.status(200).json({ok: true});
	});

	const firstAttemptBody = 'first-attempt';
	const secondAttemptBody = 'second-attempt-body';
	const firstAttemptBodySize = Buffer.byteLength(firstAttemptBody);
	const secondAttemptBodySize = Buffer.byteLength(secondAttemptBody);
	const eventsByAttempt: Progress[][] = [];
	let currentAttempt = 0;

	await ky.post(server.url, {
		body: 'initial',
		retry: {
			limit: 1,
			methods: ['post'],
		},
		hooks: {
			beforeRequest: [
				({request, retryCount}) => {
					currentAttempt = retryCount;
					eventsByAttempt[currentAttempt] = [];
					return new Request(request, {body: firstAttemptBody});
				},
			],
			beforeRetry: [
				({request}) => {
					currentAttempt = 1;
					eventsByAttempt[currentAttempt] = [];
					return new Request(request, {body: secondAttemptBody});
				},
			],
		},
		onUploadProgress(progress) {
			eventsByAttempt[currentAttempt].push(progress);
		},
	}).json();

	t.is(eventsByAttempt.length, 2);
	const firstAttemptFinalProgress = eventsByAttempt[0].at(-1);
	const secondAttemptFinalProgress = eventsByAttempt[1].at(-1);
	t.truthy(firstAttemptFinalProgress);
	t.truthy(secondAttemptFinalProgress);
	t.is(firstAttemptFinalProgress!.percent, 1);
	t.is(secondAttemptFinalProgress!.percent, 1);
	t.is(firstAttemptFinalProgress!.transferredBytes, firstAttemptBodySize);
	t.is(secondAttemptFinalProgress!.transferredBytes, secondAttemptBodySize);
	t.is(eventsByAttempt[0].filter(progress => progress.percent === 1).length, 1);
	t.is(eventsByAttempt[1].filter(progress => progress.percent === 1).length, 1);
});

test('ReadableStream upload emits stable non-final progress and completes once', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		let receivedBytes = 0;
		for await (const chunk of request) {
			receivedBytes += chunk.length as number;
		}

		response.json({receivedBytes});
	});

	const streamBody = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('chunk-1'));
			controller.enqueue(new TextEncoder().encode('chunk-2'));
			controller.close();
		},
	});

	const progressEvents: Progress[] = [];
	const response = await ky
		.post(server.url, {
			body: streamBody,
			onUploadProgress(progress) {
				progressEvents.push(progress);
			},
		})
		.json<{receivedBytes: number}>();

	t.true(progressEvents.length > 0, 'Should emit upload progress');
	const nonFinalProgressEvents = progressEvents.filter(progress => progress.percent < 1);
	t.true(nonFinalProgressEvents.length > 0, 'Should emit non-final progress');
	for (const progress of nonFinalProgressEvents) {
		t.true(progress.percent >= 0 && progress.percent < 1, 'Non-final progress should be within [0, 1)');
	}

	const completedProgressEvents = progressEvents.filter(progress => progress.percent === 1);
	t.is(completedProgressEvents.length, 1, 'Should complete exactly once');
	const finalProgress = completedProgressEvents[0];
	t.is(finalProgress.transferredBytes, response.receivedBytes);
});

test('empty response body completes download progress', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.header('content-length', '0').end();
	});

	const progressEvents: Array<{progress: Progress; chunk: Uint8Array}> = [];
	const responseText = await ky(server.url, {
		onDownloadProgress(progress, chunk) {
			progressEvents.push({progress, chunk});
		},
	}).text();

	t.is(responseText, '');
	t.deepEqual(progressEvents, [{
		progress: {percent: 1, totalBytes: 0, transferredBytes: 0},
		chunk: new Uint8Array(),
	}]);
});

test('onDownloadProgress preserves response url, redirected, and type', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('ok');
	});
	server.get('/redirect', (_request, response) => {
		response.redirect(302, '/');
	});

	const response = await ky(`${server.url}/redirect`, {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		onDownloadProgress() {},
	});

	t.is(await response.text(), 'ok');
	t.is(response.url, `${server.url}/`);
	t.true(response.redirected);
	t.is(response.type, 'basic');
});

test('onDownloadProgress preserves response metadata through repeated clones', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('ok');
	});
	server.get('/redirect', (_request, response) => {
		response.redirect(302, '/');
	});

	const progressEvents: Progress[] = [];
	const response = await ky(`${server.url}/redirect`, {
		onDownloadProgress(progress) {
			progressEvents.push(progress);
		},
	});
	const clone = response.clone();
	const nestedClone = clone.clone();

	for (const currentResponse of [response, clone, nestedClone]) {
		t.is(currentResponse.url, `${server.url}/`);
		t.true(currentResponse.redirected);
		t.is(currentResponse.type, 'basic');
	}

	t.deepEqual(await Promise.all([response.text(), clone.text(), nestedClone.text()]), ['ok', 'ok', 'ok']);
	t.is(progressEvents.filter(progress => progress.percent === 1).length, 1);
	t.throws(() => clone.clone(), {instanceOf: TypeError});
});

test('onDownloadProgress keeps clone writable and configurable', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('ok');
	});

	const response = await ky(server.url, {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		onDownloadProgress() {},
	});
	const originalClone = response.clone;
	let cloneCallCount = 0;

	response.clone = () => {
		cloneCallCount++;
		return originalClone();
	};

	const clone = response.clone();

	t.is(cloneCallCount, 1);
	t.is(await clone.text(), 'ok');
	t.true(Object.getOwnPropertyDescriptor(response, 'clone')?.configurable);
});

test('onDownloadProgress preserves the final url and redirected state without redirects', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('ok');
	});

	const response = await ky(server.url, {
		searchParams: {foo: 'bar'},
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		onDownloadProgress() {},
	});

	t.is(await response.text(), 'ok');
	t.is(response.url, `${server.url}/?foo=bar`);
	t.false(response.redirected);
});

test('onDownloadProgress consumes original response body', async t => {
	let originalResponse: Response | undefined;
	let didReportProgress = false;

	const customFetch: typeof fetch = async request => {
		if (!(request instanceof Request)) {
			throw new TypeError('Expected input to be a Request');
		}

		const responseBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('ok'));
				controller.close();
			},
		});

		const response = new Response(responseBody, {
			headers: {
				'content-length': '2',
			},
		});
		originalResponse = response;

		return response;
	};

	const responseText = await ky('https://example.com', {
		fetch: customFetch,
		onDownloadProgress() {
			didReportProgress = true;
		},
	}).text();

	t.is(responseText, 'ok');
	t.true(originalResponse?.bodyUsed);
	t.true(didReportProgress);
});

test('canceling a download with progress cancels its source without reporting completion', async t => {
	t.timeout(2000);
	const cancellation = Promise.withResolvers<void>();
	let reportedCompletion = false;
	const response = await ky('https://example.com', {
		maxResponseSize: 4,
		fetch: async () => new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
			},
			cancel() {
				cancellation.resolve();
			},
		})),
		onDownloadProgress({percent}) {
			reportedCompletion ||= percent === 1;
		},
	});
	const reader = response.body!.getReader();
	const chunk = await reader.read();
	t.deepEqual(chunk, {done: false, value: new Uint8Array([1, 2])});
	await reader.cancel();
	await cancellation.promise;
	t.false(reportedCompletion);
});

test('forced retry custom request keeps upload progress', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	let requestCount = 0;

	server.post('/', async (request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.status(500).json({error: 'try again'});
			return;
		}

		const body = await parseJsonBody<Record<string, unknown>>(request);
		response.json(body);
	});

	const attemptEvents: Progress[][] = [];
	const payload = {payload: 'forced-retry'};

	const responseJson = await ky
		.post(server.url, {
			json: payload,
			retry: {
				limit: 1,
				methods: ['post'],
			},
			hooks: {
				beforeRequest: [
					() => {
						attemptEvents.push([]);
					},
				],
				beforeRetry: [
					() => {
						attemptEvents.push([]);
					},
				],
				afterResponse: [
					async ({request, response}) => {
						if (response.status === 500) {
							return ky.retry({request: new Request(request)});
						}
					},
				],
			},
			onUploadProgress(progress) {
				const currentAttempt = attemptEvents.at(-1);
				if (!currentAttempt) {
					return;
				}

				currentAttempt.push(progress);
			},
		})
		.json<Record<string, unknown>>();

	t.deepEqual(responseJson, payload);
	t.is(attemptEvents.length, 2, 'Should attempt request twice');

	for (const [index, events] of attemptEvents.entries()) {
		t.true(events.length > 0, `Attempt ${index + 1} should emit upload progress`);
		const last = events.at(-1);
		t.truthy(last);
		t.is(last!.percent, 1, `Attempt ${index + 1} progress should reach completion`);

		// Verify gradual progress (not just 0% -> 100%)
		// With proper body size calculation, we should see intermediate progress events
		t.true(last!.totalBytes > 0, `Attempt ${index + 1} should have correct totalBytes (got ${last!.totalBytes})`);
		t.true(last!.transferredBytes > 0, `Attempt ${index + 1} should have transferredBytes`);
		t.is(last!.totalBytes, last!.transferredBytes, `Attempt ${index + 1} final totalBytes should equal transferredBytes`);
	}
});

test('forced retry custom request has correct body size for upload progress', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	let requestCount = 0;

	server.post('/', async (request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.status(500).json({error: 'try again'});
			return;
		}

		const body = await parseJsonBody<Record<string, unknown>>(request);
		response.json(body);
	});

	const attemptTotalBytes: number[] = [];
	const payload = {data: 'x'.repeat(1000)}; // 1KB payload

	await ky
		.post(server.url, {
			json: payload,
			retry: {
				limit: 1,
				methods: ['post'],
			},
			hooks: {
				afterResponse: [
					async ({request, response}) => {
						if (response.status === 500) {
							return ky.retry({request: new Request(request)});
						}
					},
				],
			},
			onUploadProgress(progress) {
				if (progress.percent === 1) {
					attemptTotalBytes.push(progress.totalBytes);
				}
			},
		})
		.json<Record<string, unknown>>();

	t.is(attemptTotalBytes.length, 2, 'Should track totalBytes for both attempts');

	// Both attempts should have the same totalBytes (proving body size is correctly preserved)
	t.is(attemptTotalBytes[0], attemptTotalBytes[1], 'Both attempts should have identical totalBytes');

	// Verify totalBytes is non-zero (correct size calculation)
	t.true(attemptTotalBytes[0] > 1000, `totalBytes should be > 1000 (got ${attemptTotalBytes[0]})`);
});

test('beforeRetry override updates upload progress after body change', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	let requestCount = 0;

	server.post('/', async (request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.status(500).json({error: 'retry'});
			return;
		}

		const body = await parseJsonBody<Record<string, unknown>>(request);
		response.json(body);
	});

	const firstPayload = {attempt: 'initial'};
	const updatedPayload = {attempt: 'retry', data: 'x'.repeat(2048)};
	const updatedPayloadString = JSON.stringify(updatedPayload);
	const attempts: Progress[][] = [];

	const responseJson = await ky
		.post(server.url, {
			json: firstPayload,
			retry: {
				limit: 1,
				methods: ['post'],
			},
			hooks: {
				beforeRequest: [
					() => {
						attempts.push([]);
					},
				],
				beforeRetry: [
					({request}) => {
						attempts.push([]);
						return new Request(request, {body: updatedPayloadString});
					},
				],
			},
			onUploadProgress(progress) {
				const currentAttempt = attempts.at(-1);
				if (!currentAttempt) {
					return;
				}

				currentAttempt.push(progress);
			},
		})
		.json<Record<string, unknown>>();

	t.deepEqual(responseJson, updatedPayload);
	t.is(attempts.length, 2, 'Should perform two attempts');

	const firstAttempt = attempts[0];
	const secondAttempt = attempts[1];
	t.truthy(firstAttempt);
	t.truthy(secondAttempt);

	const firstFinal = firstAttempt.at(-1);
	const secondFinal = secondAttempt.at(-1);
	t.truthy(firstFinal);
	t.truthy(secondFinal);

	t.is(firstFinal!.percent, 1);
	t.true(firstFinal!.totalBytes > 0);
	t.is(firstFinal!.totalBytes, firstFinal!.transferredBytes);

	const expectedUpdatedTotal = Buffer.byteLength(updatedPayloadString);
	t.is(secondFinal!.percent, 1);
	t.is(secondFinal!.totalBytes, expectedUpdatedTotal, 'Retry should reflect new payload size');
	t.is(secondFinal!.transferredBytes, expectedUpdatedTotal);
});

test('forced retry with custom request updates upload progress size', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	let requestCount = 0;

	server.post('/', async (request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.status(500).json({error: 'forced-retry'});
			return;
		}

		const body = await parseJsonBody<Record<string, unknown>>(request);
		response.json(body);
	});

	const firstPayload = {attempt: 'initial'};
	const updatedPayload = {attempt: 'forced', data: 'y'.repeat(3072)};
	const updatedPayloadString = JSON.stringify(updatedPayload);
	const attempts: Progress[][] = [];

	const responseJson = await ky
		.post(server.url, {
			json: firstPayload,
			retry: {
				limit: 1,
				methods: ['post'],
			},
			hooks: {
				beforeRequest: [
					() => {
						attempts.push([]);
					},
				],
				beforeRetry: [
					() => {
						attempts.push([]);
					},
				],
				afterResponse: [
					async ({request, response}) => {
						if (response.status === 500) {
							return ky.retry({
								request: new Request(request, {body: updatedPayloadString}),
							});
						}
					},
				],
			},
			onUploadProgress(progress) {
				const currentAttempt = attempts.at(-1);
				if (!currentAttempt) {
					return;
				}

				currentAttempt.push(progress);
			},
		})
		.json<Record<string, unknown>>();

	t.deepEqual(responseJson, updatedPayload);
	t.is(attempts.length, 2, 'Should perform two attempts');

	const firstAttempt = attempts[0];
	const secondAttempt = attempts[1];
	t.truthy(firstAttempt);
	t.truthy(secondAttempt);

	const firstFinal = firstAttempt.at(-1);
	const secondFinal = secondAttempt.at(-1);
	t.truthy(firstFinal);
	t.truthy(secondFinal);

	t.is(firstFinal!.percent, 1);
	t.true(firstFinal!.totalBytes > 0);
	t.is(firstFinal!.totalBytes, firstFinal!.transferredBytes);

	const expectedUpdatedTotal = Buffer.byteLength(updatedPayloadString);
	t.is(secondFinal!.percent, 1);
	t.is(secondFinal!.totalBytes, expectedUpdatedTotal, 'Forced retry should reflect new payload size');
	t.is(secondFinal!.transferredBytes, expectedUpdatedTotal);
});

test('POST FormData with 10MB file upload progress', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		let totalBytes = 0;
		for await (const chunk of request) {
			totalBytes += chunk.length as number;
		}

		response.json({receivedBytes: totalBytes});
	});

	const largeBlob = createLargeBlob(10); // 10MB Blob
	const formData = new FormData();
	formData.append('file', largeBlob, 'large-file.bin');

	const data: Array<{
		percent: number;
		transferredBytes: number;
		totalBytes: number;
	}> = [];
	const response = await ky
		.post(server.url, {
			body: formData,
			onUploadProgress(progress) {
				data.push(progress);
			},
		})
		.json<{receivedBytes: number}>();

	// Check if we have at least two progress updates
	t.true(data.length >= 2, 'Should have at least two progress updates');

	// Check the first progress update
	t.true(
		data[0].percent >= 0 && data[0].percent < 1,
		'First update should have progress between 0 and 100%',
	);
	t.true(
		data[0].transferredBytes >= 0,
		'First update should have non-negative transferred bytes',
	);

	// Check intermediate updates (if any)
	for (let i = 1; i < data.length - 1; i++) {
		t.true(
			data[i].percent >= data[i - 1].percent,
			`Update ${i} should have higher or equal percent than previous`,
		);
		t.true(
			data[i].transferredBytes >= data[i - 1].transferredBytes,
			`Update ${i} should have more or equal transferred bytes than previous`,
		);
	}

	// Check the last progress update
	const lastUpdate = data.at(-1);
	t.is(lastUpdate.percent, 1, 'Last update should have 100% progress');
	t.true(
		lastUpdate.totalBytes > 0,
		'Last update should have positive total bytes',
	);
	t.is(
		lastUpdate.transferredBytes,
		lastUpdate.totalBytes,
		'Last update should have transferred all bytes',
	);
});

test('completed download progress uses actual bytes rather than an overestimated content length', async t => {
	const progressEvents: Progress[] = [];
	const text = await ky('https://example.com', {
		fetch: async () => new Response('ok', {headers: {'content-length': '1024'}}),
		onDownloadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(text, 'ok');
	t.deepEqual(progressEvents.at(-1), {
		percent: 1,
		transferredBytes: 2,
		totalBytes: 2,
	});
});

test('completed upload progress uses the actual size of a replaced body', async t => {
	const progressEvents: Progress[] = [];
	const originalBody = 'x'.repeat(1024);
	const replacementBody = 'ok';
	const text = await ky.post('https://example.com', {
		body: originalBody,
		retry: 0,
		hooks: {
			beforeRequest: [({request}) => new Request(request, {body: replacementBody})],
		},
		async fetch(request) {
			return new Response(await request.text());
		},
		onUploadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(text, replacementBody);
	t.deepEqual(progressEvents.at(-1), {
		percent: 1,
		transferredBytes: 2,
		totalBytes: 2,
	});
});

// The upload progress tests below share a server that records how many requests reached it.
const createUploadProgressTestServer = async (t: ExecutionContext) => {
	let requestCount = 0;
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		requestCount++;
		await parseRawBody(request);
		response.end('ok');
	});

	return {server, getRequestCount: () => requestCount};
};

// A throwing progress callback is a user-space error, so it must surface as that error rather than as a network failure. Upload progress runs inside the request body stream, where the runtime reports any stream error as a `TypeError: fetch failed` that Ky would otherwise classify as a `NetworkError`.
test('a throwing upload progress callback propagates its own error', async t => {
	const {server, getRequestCount} = await createUploadProgressTestServer(t);

	const callbackError = new Error('upload progress failed');
	const error = await t.throwsAsync(ky.post(server.url, {
		body: 'x'.repeat(1024),
		retry: 0,
		onUploadProgress() {
			throw callbackError;
		},
	}).text());

	t.is(error, callbackError);
	t.is(error.name, 'Error');
	t.is(error.message, 'upload progress failed');
	t.false(isNetworkError(error));
	t.is(getRequestCount(), 0);
});

test('a throwing upload progress callback is not retried as a network error', async t => {
	const {server} = await createUploadProgressTestServer(t);
	let beforeRetryCalls = 0;

	// A `NetworkError` would be retried for this method, which would re-send the body of a failed callback.
	const error = await t.throwsAsync(ky.post(server.url, {
		body: 'x'.repeat(1024),
		retry: {limit: 2, delay: () => 0, methods: ['post']},
		hooks: {
			beforeRetry: [() => {
				beforeRetryCalls++;
			}],
		},
		onUploadProgress() {
			throw new Error('upload progress failed');
		},
	}).text());

	t.is(error.message, 'upload progress failed');
	t.is(beforeRetryCalls, 0);
});

test('a throwing upload progress callback is visible to beforeError hooks', async t => {
	const {server} = await createUploadProgressTestServer(t);

	const seen: string[] = [];
	const error = await t.throwsAsync(ky.post(server.url, {
		body: 'x'.repeat(1024),
		retry: 0,
		hooks: {
			beforeError: [({error}) => {
				seen.push(`${error.name}: ${error.message}`);
				return error;
			}],
		},
		onUploadProgress() {
			throw new Error('upload progress failed');
		},
	}).text());

	t.is(error.message, 'upload progress failed');
	t.deepEqual(seen, ['Error: upload progress failed']);
});

test('a throwing download progress callback propagates its own error', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('body');
	});

	const callbackError = new Error('download progress failed');
	const error = await t.throwsAsync(ky(server.url, {
		retry: 0,
		onDownloadProgress() {
			throw callbackError;
		},
	}).text());

	t.is(error, callbackError);
	t.false(isNetworkError(error));
});

// `Progress.totalBytes` is documented to be `0` when the total size cannot be determined, and it must agree with the `percent` it is reported with, which is computed from the same estimate.
test('download progress reports an unknown total as 0', async t => {
	const progressEvents: Progress[] = [];
	const text = await ky('https://example.com', {
		retry: 0,
		fetch: async () => new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('ab'));
				controller.enqueue(new TextEncoder().encode('cd'));
				controller.close();
			},
		}), {headers: {'content-type': 'text/plain'}}),
		onDownloadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(text, 'abcd');
	t.deepEqual(progressEvents.at(0), {percent: 0, transferredBytes: 2, totalBytes: 0});
	t.deepEqual(progressEvents.at(-1), {percent: 1, transferredBytes: 4, totalBytes: 4});
});

test('download progress keeps reporting the estimate when it is smaller than the bytes transferred', async t => {
	const progressEvents: Progress[] = [];
	await ky('https://example.com', {
		retry: 0,
		fetch: async () => new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('ab'));
				controller.enqueue(new TextEncoder().encode('cd'));
				controller.close();
			},
		}), {headers: {'content-type': 'text/plain', 'content-length': '2'}}),
		onDownloadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.deepEqual(progressEvents.at(0), {
		// The size estimate is exceeded, so `percent` is capped just below 1 instead of reporting completion.
		percent: 1 - Number.EPSILON,
		transferredBytes: 2,
		totalBytes: 2,
	});
});

// `content-length` is the size of the encoded body on the wire, while the progress stream counts the bytes after decompression. Trusting it made every event report 100% for a compressed response, so a progress bar was useless for exactly the responses that are large enough to need one.
test('download progress does not trust content-length for a compressed response', async t => {
	const progressEvents: Progress[] = [];
	const text = await ky('https://example.com', {
		async fetch() {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					for (let index = 0; index < 8; index++) {
						controller.enqueue(new Uint8Array(1024));
					}

					controller.close();
				},
			});

			return new Response(body, {headers: {'content-length': '64', 'content-encoding': 'gzip'}});
		},
		onDownloadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(text.length, 8192);
	t.true(progressEvents.length > 1);
	// The encoded size is not a usable total, so it is reported as unknown instead of pinning every event to ~100%.
	for (const event of progressEvents.slice(0, -1)) {
		t.is(event.percent, 0);
		t.is(event.totalBytes, 0);
	}

	t.deepEqual(progressEvents.at(-1), {
		percent: 1,
		transferredBytes: 8192,
		totalBytes: 8192,
	});
});

test('download progress still uses content-length for an uncompressed response', async t => {
	const progressEvents: Progress[] = [];
	const text = await ky('https://example.com', {
		fetch: async () => new Response('x'.repeat(64), {headers: {'content-length': '64'}}),
		onDownloadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(text.length, 64);
	t.is(progressEvents.at(-1)?.totalBytes, 64);
});

// A coding list that mentions `identity` alongside a real coding is still content-coded, so the encoded length cannot be used.
test('download progress reports an unknown total for a multi-coding content-encoding', async t => {
	const progressEvents: Progress[] = [];
	const text = await ky('https://example.com', {
		async fetch() {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					for (let index = 0; index < 8; index++) {
						controller.enqueue(new Uint8Array(1024));
					}

					controller.close();
				},
			});
			return new Response(body, {headers: {'content-length': '64', 'content-encoding': 'identity, gzip'}});
		},
		onDownloadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(text.length, 8192);
	for (const event of progressEvents.slice(0, -1)) {
		t.is(event.totalBytes, 0);
	}

	t.deepEqual(progressEvents.at(-1), {percent: 1, totalBytes: 8192, transferredBytes: 8192});
});

// `content-encoding: identity` is a registered no-op coding (RFC 9110 §8.4.2), so `content-length` is the decoded length and remains a valid total, as it is for a response with no `content-encoding` at all.
for (const [label, headers] of [
	['no content-encoding', {}],
	['content-encoding: identity', {'content-encoding': 'identity'}],
	['content-encoding: Identity', {'content-encoding': 'Identity'}],
	['an empty content-encoding', {'content-encoding': ''}],
] as Array<[string, Record<string, string>]>) {
	test(`download progress uses content-length with ${label}`, async t => {
		const progressEvents: Progress[] = [];
		const text = await ky('https://example.com', {
			async fetch() {
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						for (let index = 0; index < 8; index++) {
							controller.enqueue(new Uint8Array(1024));
						}

						controller.close();
					},
				});
				return new Response(body, {headers: {'content-length': '8192', ...headers}});
			},
			onDownloadProgress(progress) {
				progressEvents.push(progress);
			},
		}).text();

		t.is(text.length, 8192);
		t.is(progressEvents.at(-1)?.totalBytes, 8192);
		t.is(progressEvents[0]?.totalBytes, 8192);
		// 1024 of 8192 bytes on the first event, so the percentage has to climb from there.
		t.is(progressEvents[0]?.percent, 0.125);
	});
}

// A `ReadableStream` body measures 0, so the upload estimate stayed 0 and the percentage never moved, even when the request itself declared a `content-length`. The download path already falls back to that header.
test('upload progress uses a declared content-length when the body size is unknown', async t => {
	const progressEvents: Progress[] = [];
	let body = '';

	await ky.post('https://example.com', {
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('a'.repeat(1024)));
				controller.enqueue(new TextEncoder().encode('a'.repeat(1024)));
				controller.close();
			},
		}),
		headers: {'content-length': '2048'},
		retry: 0,
		async fetch(request) {
			body = await request.clone().text();
			return new Response('ok');
		},
		onUploadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(body.length, 2048);
	t.deepEqual(progressEvents.at(-1), {percent: 1, totalBytes: 2048, transferredBytes: 2048});
	t.is(progressEvents[0]?.totalBytes, 2048);
	t.true(progressEvents[0]!.percent > 0, 'the first event should not sit at 0%');
});

test('upload progress still prefers the body it can measure', async t => {
	const progressEvents: Progress[] = [];

	await ky.post('https://example.com', {
		body: 'x'.repeat(10),
		headers: {'content-length': '2048'},
		retry: 0,
		async fetch(request) {
			await request.text();
			return new Response('ok');
		},
		onUploadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(progressEvents.at(-1)?.totalBytes, 10);
});

// The byte accounting holds the last chunk back so the final event can report the real total, which means an intermediate event is attributed to the previous chunk. Chunks of differing sizes are what pins that down, and an estimate below the delivered size is what makes the reported total grow.
test('progress attributes bytes to the chunk before the one arriving', async t => {
	const chunkSizes = [10, 30, 20, 40];
	const chunks: number[] = [];
	const transferred: number[] = [];
	const totals: number[] = [];

	const text = await ky('https://example.com', {
		async fetch() {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					for (const size of chunkSizes) {
						controller.enqueue(new Uint8Array(size));
					}

					controller.close();
				},
			});
			// A total below the delivered size, so the reported total has to grow.
			return new Response(body, {headers: {'content-length': '1'}});
		},
		onDownloadProgress({totalBytes, transferredBytes}, chunk) {
			chunks.push(chunk.byteLength);
			transferred.push(transferredBytes);
			totals.push(totalBytes);
		},
	}).text();

	t.is(text.length, 100);
	// Each event carries the chunk it was counted for, so the sizes run one behind the arrival order.
	t.deepEqual(chunks, chunkSizes);
	t.deepEqual(transferred, [10, 40, 60, 100]);
	// Each intermediate event reports the running total, which starts below the estimate and grows past it.
	t.deepEqual(totals, [10, 40, 60, 100]);
});

// A response with no body at all is not streamed. That covers a null body status, and a `HEAD` response in runtimes that give it no body, such as Node.js.
test('download progress stays silent for a null body status', async t => {
	let calls = 0;
	const result = await ky('https://example.com', {
		fetch: async () => new Response(null, {status: 204}),
		onDownloadProgress() {
			calls++;
		},
	});

	t.is(result.status, 204);
	t.is(calls, 0);
});

test('download progress stays silent for a HEAD response', async t => {
	const server = await createHttpTestServer(t);
	server.head('/', (_request, response) => {
		response.setHeader('content-length', '1000');
		response.end();
	});

	let calls = 0;
	const result = await ky.head(server.url, {
		onDownloadProgress() {
			calls++;
		},
	});

	t.is(result.status, 200);
	t.is(result.headers.get('content-length'), '1000');
	t.is(calls, 0);
});

// A throwing progress callback is a user-space error, but `#fetch()` rethrows it as a plain `Error`, so a `shouldRetry` that returns `true` for everything re-sent the body and ran the callback again.
test('a throwing upload progress callback is not retried even when `shouldRetry` returns true', async t => {
	const {server, getRequestCount} = await createUploadProgressTestServer(t);
	let callbackCalls = 0;
	let beforeRetryCalls = 0;

	await t.throwsAsync(ky.post(server.url, {
		body: 'x'.repeat(1024),
		retry: {
			limit: 3,
			methods: ['post'],
			delay: () => 0,
			shouldRetry: () => true,
		},
		hooks: {
			beforeRetry: [() => {
				beforeRetryCalls++;
			}],
		},
		onUploadProgress() {
			callbackCalls++;
			throw new Error('upload progress failed');
		},
	}).text(), {message: 'upload progress failed'});

	t.is(getRequestCount(), 0);
	t.is(callbackCalls, 1);
	t.is(beforeRetryCalls, 0);
});

// The marker only accepted `Error` values, so a callback that threw a string was still retried even though a callback that threw an `Error` was not. A `Ky` instance lives for one request, so a strong `Set` is safe.
test('a non-Error throw from an upload progress callback is not retried either', async t => {
	const {server, getRequestCount} = await createUploadProgressTestServer(t);
	let callbackCalls = 0;

	try {
		await ky.post(server.url, {
			body: 'x'.repeat(1024),
			retry: {
				limit: 3,
				methods: ['post'],
				delay: () => 0,
				shouldRetry: () => true,
			},
			onUploadProgress() {
				callbackCalls++;
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw 'upload progress failed';
			},
		}).text();
		t.fail('should have thrown');
	} catch (error) {
		t.is(error, 'upload progress failed');
	}

	t.is(getRequestCount(), 0);
	t.is(callbackCalls, 1);
});

// The response wrappers already skip a body a hook read, so the native error names the mistake. The upload wrapper did not, and failed with "The ReadableStream is locked" instead.
test('upload progress leaves a request body that a hook already read to the native error', async t => {
	const run = async (onUploadProgress?: () => void) => t.throwsAsync(ky.post('https://example.com', {
		body: 'x',
		retry: 0,
		onUploadProgress,
		fetch: async input => new Response(await (input as Request).text()),
		hooks: {
			beforeRequest: [async ({request}) => {
				await request.text();
			}],
		},
	}).text());

	const withoutProgress = await run();
	const withProgress = await run(() => undefined);

	t.truthy(withoutProgress?.message);
	t.is(withProgress?.message, withoutProgress?.message);
});
