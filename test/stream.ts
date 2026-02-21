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
