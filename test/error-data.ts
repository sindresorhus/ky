import test, {type ExecutionContext} from 'ava';
import ky, {HTTPError, type Options} from '../source/index.js';

const mebibyte = 1024 * 1024;

const errorResponse = (body: BodyInit | undefined, contentType?: string, status = 400): Response => new Response(body, {
	status,
	headers: contentType === undefined ? {} : {'content-type': contentType},
});

const getHttpError = async (t: ExecutionContext, response: Response, options: Options = {}): Promise<HTTPError> => {
	const error = await t.throwsAsync(ky('https://example.com', {
		retry: 0,
		async fetch() {
			return response;
		},
		...options,
	}), {instanceOf: HTTPError});

	return error!;
};

const getErrorData = async (t: ExecutionContext, body: BodyInit | undefined, contentType?: string): Promise<unknown> => {
	const error = await getHttpError(t, errorResponse(body, contentType));
	return error.data;
};

// Yields `chunkCount` chunks of `chunkSize` bytes followed by an optional tail chunk, and records pulls and cancellation.
const createChunkedStream = ({chunkCount, chunkSize, tailSize = 0}: {chunkCount: number; chunkSize: number; tailSize?: number}) => {
	const state = {pulls: 0, cancelled: false};
	let sentChunks = 0;
	let sentTail = false;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			state.pulls++;
			if (sentChunks < chunkCount) {
				sentChunks++;
				controller.enqueue(new Uint8Array(chunkSize).fill(0x61));
				return;
			}

			if (tailSize > 0 && !sentTail) {
				sentTail = true;
				controller.enqueue(new Uint8Array(tailSize).fill(0x61));
				return;
			}

			controller.close();
		},
		cancel() {
			state.cancelled = true;
		},
	});

	return {stream, state};
};

const latin1Cafe = Uint8Array.from([0x63, 0x61, 0x66, 0xE9]);

test('error data is undefined when chunks add up to one byte over the 10 MiB cap', async t => {
	const {stream} = createChunkedStream({chunkCount: 10, chunkSize: mebibyte, tailSize: 1});
	t.is(await getErrorData(t, stream, 'text/plain'), undefined);
});

test('exceeding the error data cap cancels the response stream', async t => {
	const {stream, state} = createChunkedStream({chunkCount: 1000, chunkSize: mebibyte});
	t.is(await getErrorData(t, stream, 'text/plain'), undefined);
	t.true(state.cancelled);
	t.true(state.pulls < 20);
});

test('error data is parsed as JSON for the application/x-json subtype', async t => {
	t.deepEqual(await getErrorData(t, '{"error":"subtype"}', 'application/x-json'), {error: 'subtype'});
});

test('error data is parsed as JSON when the media type is uppercase', async t => {
	t.deepEqual(await getErrorData(t, '{"error":"uppercase"}', 'APPLICATION/PROBLEM+JSON'), {error: 'uppercase'});
});

test('error data is parsed as JSON when whitespace precedes the parameters', async t => {
	t.deepEqual(await getErrorData(t, '{"error":"spaced"}', 'application/json ; charset=utf-8'), {error: 'spaced'});
});

test('error data ignores a parameter whose name only ends in charset', async t => {
	t.is(await getErrorData(t, 'café', 'text/plain; xcharset=utf-16le'), 'café');
});

test('error data uses a charset that follows other parameters', async t => {
	t.is(await getErrorData(t, latin1Cafe, 'text/plain; format=flowed; charset=iso-8859-1'), 'café');
});

test('error data allows whitespace around the charset equals sign', async t => {
	t.is(await getErrorData(t, latin1Cafe, 'text/plain; charset = iso-8859-1'), 'café');
});

test('error data charset ends at the comma of a combined content-type header', async t => {
	const headers = new Headers();
	headers.append('content-type', 'text/plain; charset=iso-8859-1');
	headers.append('content-type', 'text/plain');
	const error = await getHttpError(t, new Response(latin1Cafe, {status: 400, headers}));
	t.is(error.data, 'café');
});

test('error data decodes invalid UTF-8 with replacement characters when no charset is given', async t => {
	t.is(await getErrorData(t, Uint8Array.from([0x61, 0xFF, 0x62]), 'text/plain'), 'a�b');
});

test('error data is undefined and HTTPError is still thrown when the body stream fails after partial data', async t => {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('partial'));
		},
		pull(controller) {
			controller.error(new Error('connection reset'));
		},
	});

	t.is(await getErrorData(t, body, 'text/plain'), undefined);
});

test('error data is undefined when a response without a body stream fails to read text', async t => {
	const response = errorResponse('unused', 'text/plain');
	Object.defineProperty(response, 'body', {value: null});
	Object.defineProperty(response, 'text', {
		async value() {
			throw new TypeError('body unavailable');
		},
	});

	const error = await getHttpError(t, response);
	t.is(error.data, undefined);
});

test('error.options is a frozen snapshot without Ky-only size and timeout options', async t => {
	const error = await getHttpError(t, errorResponse('bad', 'text/plain'), {
		method: 'post',
		context: {tag: 'value'},
		timeout: 5000,
		totalTimeout: 60_000,
		maxResponseSize: mebibyte,
		throwHttpErrors: true,
	});

	t.true(Object.isFrozen(error.options));
	t.is(error.options.method, 'POST');
	t.deepEqual(error.options.context, {tag: 'value'});
	for (const key of ['timeout', 'totalTimeout', 'maxResponseSize', 'throwHttpErrors', 'fetch']) {
		t.false(Object.hasOwn(error.options, key), key);
	}
});

test('the throwHttpErrors predicate is not called for successful responses', async t => {
	const statuses: number[] = [];
	const response = await ky('https://example.com', {
		retry: 0,
		throwHttpErrors(status) {
			statuses.push(status);
			return true;
		},
		async fetch() {
			return new Response('ok', {status: 201});
		},
	});

	t.is(await response.text(), 'ok');
	t.deepEqual(statuses, []);
});

test('the throwHttpErrors predicate is not called for opaque responses', async t => {
	let calls = 0;
	const response = await ky('https://example.com', {
		retry: 0,
		throwHttpErrors() {
			calls++;
			throw new Error('The predicate must not be called');
		},
		async fetch() {
			const response = new Response(undefined);
			Object.defineProperty(response, 'type', {value: 'opaque'});
			Object.defineProperty(response, 'ok', {value: false});
			Object.defineProperty(response, 'status', {value: 0});
			return response;
		},
	});

	t.is(response.status, 0);
	t.is(calls, 0);
});

test('error data is undefined and HTTPError is still thrown when a custom parseJson throws synchronously', async t => {
	let parseJsonCallCount = 0;
	const error = await getHttpError(t, errorResponse('{"error":"bad"}', 'application/json'), {
		parseJson() {
			parseJsonCallCount++;
			throw new SyntaxError('Unexpected token');
		},
	});

	t.is(error.data, undefined);
	t.is(parseJsonCallCount, 1);
});

test('a custom parseJson is not called for an empty JSON error body', async t => {
	let parseJsonCallCount = 0;
	const error = await getHttpError(t, errorResponse('', 'application/json'), {
		parseJson() {
			parseJsonCallCount++;
			return {parsed: true};
		},
	});

	t.is(error.data, undefined);
	t.is(parseJsonCallCount, 0);
});

test('a falsy value from a custom parseJson is kept as the error data', async t => {
	for (const value of [0, false, '']) {
		// eslint-disable-next-line no-await-in-loop
		const error = await getHttpError(t, errorResponse('{"error":"bad"}', 'application/json'), {
			parseJson: () => value,
		});

		t.is(error.data, value);
	}
});

// `Headers` joins repeated values with a comma. Ky checks the text before the first `;` for a JSON subtype, so without parameters the last media type decides, which agrees with how the Fetch standard extracts a MIME type from a combined header.
for (const [first, second, expected] of [
	['application/json', 'application/json', {error: 'combined'}],
	['text/plain', 'application/json', {error: 'combined'}],
	['application/json', 'text/plain', '{"error":"combined"}'],
] as const) {
	test(`error data for a combined \`${first}, ${second}\` content-type header`, async t => {
		const headers = new Headers();
		headers.append('content-type', first);
		headers.append('content-type', second);
		const error = await getHttpError(t, new Response('{"error":"combined"}', {status: 400, headers}));
		t.deepEqual(error.data, expected);
	});
}
