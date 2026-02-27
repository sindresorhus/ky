import test from 'ava';
import ky, {type Progress} from '../source/index.js';
import {createLargeBlob} from './helpers/create-large-file.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';
import {parseRawBody, parseJsonBody} from './helpers/parse-body.js';

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

	const completedUploadProgressEventsPerAttempt: number[] = [];
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
						completedUploadProgressEventsPerAttempt.push(0);
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
					const body = retryCount === 0 ? firstAttemptBody : secondAttemptBody;
					return new Request(request, {body});
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

test('onDownloadProgress cancels original response body', async t => {
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
					({request}) => new Request(request, {body: updatedPayloadString}),
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
