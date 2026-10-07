import test from 'ava';
import ky, {
	ResponseSizeError,
	SchemaValidationError,
	type Progress,
	type StandardSchemaV1,
} from '../source/index.js';

const url = 'https://example.com/data';
const encoder = new TextEncoder();
const invalidSchemaMessage = 'The `schema` argument must follow the Standard Schema specification';

const createChunkedBody = (chunks: string[]) => new ReadableStream<Uint8Array>({
	start(controller) {
		for (const chunk of chunks) {
			controller.enqueue(encoder.encode(chunk));
		}

		controller.close();
	},
});

// A body that was partly read through a reader and then released is used but no longer locked, so only `bodyUsed` tells the wrappers to leave it alone.
const createReleasedResponse = async (): Promise<Response> => {
	const response = new Response(createChunkedBody(['first', 'second']));
	const reader = response.body!.getReader();
	await reader.read();
	reader.releaseLock();
	return response;
};

// A `content-length` that is not a size must be treated as an unknown total rather than turning `percent` negative or `NaN`.
for (const contentLength of ['-10', 'not-a-number']) {
	test(`download progress treats a content-length of ${contentLength} as an unknown total`, async t => {
		const progressEvents: Progress[] = [];
		const text = await ky(url, {
			retry: 0,
			fetch: async () => new Response(createChunkedBody(['ab', 'cd']), {headers: {'content-length': contentLength}}),
			onDownloadProgress(progress) {
				progressEvents.push(progress);
			},
		}).text();

		t.is(text, 'abcd');
		t.deepEqual(progressEvents, [
			{percent: 0, totalBytes: 0, transferredBytes: 2},
			{percent: 1, totalBytes: 4, transferredBytes: 4},
		]);
	});
}

test('upload progress treats a negative declared content-length as an unknown total', async t => {
	const progressEvents: Progress[] = [];
	await ky.post(url, {
		body: createChunkedBody(['ab', 'cd']),
		headers: {'content-length': '-10'},
		retry: 0,
		async fetch(request) {
			await (request as Request).arrayBuffer();
			return new Response('ok');
		},
		onUploadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.deepEqual(progressEvents, [
		{percent: 0, totalBytes: 0, transferredBytes: 2},
		{percent: 1, totalBytes: 4, transferredBytes: 4},
	]);
});

// Chromium replaces the size error with a generic TypeError in native body methods, so the wrappers restore it. Node.js passes the stream error through on the first read, so a second read, which natively fails with "Body is unusable", is the only way to make the native method fail with something else here. The tests below use it to check that each wrapper restores the size error.
test('a body read after the size limit was exceeded reports the size error again', async t => {
	const response = await ky(url, {
		retry: 0,
		maxResponseSize: 1,
		fetch: async () => new Response('too large'),
	});

	const firstError = await t.throwsAsync(response.text(), {instanceOf: ResponseSizeError});
	// The native method now fails with "Body is unusable", which hides why the body is gone.
	const secondError = await t.throwsAsync(response.arrayBuffer(), {instanceOf: ResponseSizeError});
	t.is(secondError, firstError);
});

// The download progress wrapper sits on top of the limited body, so it has to inherit the size error of the body it wraps.
test('a body read after the size limit was exceeded reports the size error again with download progress', async t => {
	const response = await ky(url, {
		retry: 0,
		maxResponseSize: 1,
		onDownloadProgress: () => undefined,
		fetch: async () => new Response('too large'),
	});

	const firstError = await t.throwsAsync(response.text(), {instanceOf: ResponseSizeError});
	const secondError = await t.throwsAsync(response.text(), {instanceOf: ResponseSizeError});
	t.is(secondError, firstError);
});

test('a clone keeps reporting the size error after its body failed', async t => {
	const response = await ky(url, {
		retry: 0,
		maxResponseSize: 1,
		fetch: async () => new Response('too large'),
	});

	const clone = response.clone();
	const firstError = await t.throwsAsync(clone.text(), {instanceOf: ResponseSizeError});
	const secondError = await t.throwsAsync(clone.text(), {instanceOf: ResponseSizeError});
	t.is(secondError, firstError);
});

// The `afterResponse` hook gets a clone of the limited response, and returning it wraps it in a second limit. That outer limit never sees the bytes past the inner one, so it has to report the inner error.
test('a response returned by an afterResponse hook reports the size error of the limit it already went through', async t => {
	const response = await ky(url, {
		retry: 0,
		maxResponseSize: 1,
		fetch: async () => new Response('too large'),
		hooks: {
			afterResponse: [({response}) => response],
		},
	});

	const firstError = await t.throwsAsync(response.text(), {instanceOf: ResponseSizeError});
	const secondError = await t.throwsAsync(response.text(), {instanceOf: ResponseSizeError});
	t.is(secondError, firstError);
});

for (const [label, options] of [
	['with `maxResponseSize`', {maxResponseSize: 1000}],
	['with `onDownloadProgress`', {onDownloadProgress: () => undefined}],
] as Array<[string, Record<string, unknown>]>) {
	test(`a partly read and released body reports the native error ${label}`, async t => {
		const response = await ky(url, {
			...options,
			retry: 0,
			fetch: createReleasedResponse,
		});

		await t.throwsAsync(response.text(), {
			name: 'TypeError',
			message: 'Body is unusable: Body has already been read',
		});
	});
}

for (const [label, takeBody] of [
	['locked by a reader', (request: Request) => {
		request.body!.getReader();
	}],
	['partly read and released', async (request: Request) => {
		const reader = request.body!.getReader();
		await reader.read();
		reader.releaseLock();
	}],
] as Array<[string, (request: Request) => void | Promise<void>]>) {
	test(`upload progress leaves a request body that is ${label} to the native error`, async t => {
		const run = async (onUploadProgress?: () => void) => t.throwsAsync(ky.post(url, {
			body: 'payload',
			retry: 0,
			onUploadProgress,
			fetch: async input => new Response(await (input as Request).text()),
			hooks: {
				beforeRequest: [async ({request}) => {
					await takeBody(request);
				}],
			},
		}).text());

		const withoutProgress = await run();
		const withProgress = await run(() => undefined);

		t.truthy(withoutProgress?.message);
		t.is(withProgress?.message, withoutProgress?.message);
	});
}

for (const [label, standard] of [
	['`null`', null],
	['a function with a `validate` method', Object.assign(() => undefined, {version: 1, vendor: 'test', validate: (value: unknown) => ({value})})],
] as Array<[string, unknown]>) {
	test(`.json(schema) rejects a \`~standard\` property that is ${label}`, async t => {
		await t.throwsAsync(ky(url, {
			retry: 0,
			fetch: async () => Response.json({value: 1}),
		}).json({'~standard': standard} as unknown as StandardSchemaV1), {
			instanceOf: TypeError,
			message: invalidSchemaMessage,
		});
	});
}

// A Standard Schema result signals failure by having `issues` at all, so an empty list is still a failure rather than a success without a `value`.
test('.json(schema) treats an empty issues list as a validation failure', async t => {
	const error = await t.throwsAsync(ky(url, {
		retry: 0,
		fetch: async () => Response.json({value: 1}),
	}).json({
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: () => ({issues: []}),
		},
	}), {instanceOf: SchemaValidationError});

	t.deepEqual(error?.issues, []);
});

test('a clone made after a retry of an earlier attempt response keeps the request of that attempt for parseJson', async t => {
	const sent: Request[] = [];
	const parseJsonRequests: Request[] = [];
	let firstAttemptClone: Response | undefined;

	const data = await ky(url, {
		retry: {limit: 1, delay: () => 0},
		async fetch(request) {
			sent.push(request as Request);
			return sent.length === 1 ? Response.json({attempt: 1}, {status: 500}) : Response.json({attempt: 2});
		},
		parseJson(text, {request}) {
			parseJsonRequests.push(request);
			return JSON.parse(text);
		},
		hooks: {
			afterResponse: [({response}) => {
				firstAttemptClone ??= response.clone();
			}],
		},
	}).json();

	t.deepEqual(data, {attempt: 2});
	t.is(sent.length, 2);
	parseJsonRequests.length = 0;

	// Cloned only now, after the second attempt became the request that was sent last.
	t.deepEqual(await firstAttemptClone!.clone().json(), {attempt: 1});
	t.deepEqual(parseJsonRequests, [sent[0]]);
});

// With retries enabled, the hook gets the clone prepared for the next attempt rather than the request that was sent, so releasing that clone once the request settles must spare a response built on its body.
test('an afterResponse hook can return the body of the request it was given as the response', async t => {
	const text = await ky.post(url, {
		body: 'echo-payload',
		retry: {limit: 2},
		fetch: async () => new Response('from fetch'),
		hooks: {
			afterResponse: [({request}) => new Response(request.body)],
		},
	}).text();

	t.is(text, 'echo-payload');
});

// With retries enabled, `ky.request` is the clone prepared for the next attempt by the time the response arrives, which is not the request that produced it.
test('response.json() gives parseJson the request that was sent', async t => {
	let sent: Request | undefined;
	let parseJsonRequest: Request | undefined;

	const response = await ky(url, {
		retry: {limit: 2},
		async fetch(request) {
			sent = request as Request;
			return Response.json({value: 1});
		},
		parseJson(text, {request}) {
			parseJsonRequest = request;
			return JSON.parse(text) as unknown;
		},
	});

	t.deepEqual(await response.json(), {value: 1});
	t.is(parseJsonRequest, sent);
});

test('the .json() shortcut uses a parseJson set by an init hook', async t => {
	const parsedTexts: string[] = [];

	const data = await ky(url, {
		retry: 0,
		fetch: async () => Response.json({value: 1}),
		hooks: {
			init: [options => {
				options.parseJson = text => {
					parsedTexts.push(text);
					return {parsedBy: 'init hook'};
				};
			}],
		},
	}).json();

	t.deepEqual(data, {parsedBy: 'init hook'});
	t.deepEqual(parsedTexts, ['{"value":1}']);
});

test('response.json() with parseJson consumes the body like the native method', async t => {
	const response = await ky(url, {
		retry: 0,
		fetch: async () => Response.json({value: 1}),
		parseJson: text => JSON.parse(text) as unknown,
	});

	t.deepEqual(await response.json(), {value: 1});
	t.true(response.bodyUsed);
	await t.throwsAsync(response.json(), {
		name: 'TypeError',
		message: 'Body is unusable: Body has already been read',
	});
});
