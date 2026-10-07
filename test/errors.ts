import {runInNewContext} from 'node:vm';
import test from 'ava';
import ky, {
	ForceRetryError,
	KyError,
	NetworkError,
	ResponseSizeError,
	SchemaValidationError,
	TimeoutError,
	isForceRetryError,
	isHTTPError,
	isKyError,
	isNetworkError,
	isResponseSizeError,
	isTimeoutError,
} from '../source/index.js';
import {NonError} from '../source/errors/NonError.js';
import isRawNetworkError from '../source/utils/is-network-error.js';
import delay from '../source/utils/delay.js';

const url = 'https://example.com/resource';

// Safari reports a network failure as a `TypeError` without a stack.
const createStacklessTypeError = (message: string): TypeError => {
	const error = new TypeError(message);
	error.stack = undefined;
	return error;
};

// NonError

test('NonError uses a thrown string as its message', t => {
	const error = new NonError('Connection reset');

	t.is(error.message, 'Connection reset');
	t.is(error.value, 'Connection reset');
	t.is(error.name, 'NonError');
});

test('NonError uses a default message for a value without a message', t => {
	const error = new NonError(42);

	t.is(error.message, 'Non-error value was thrown');
	t.is(error.value, 42);
});

test('NonError ignores a `message` property that is not a string', t => {
	const value = {message: 42};
	const error = new NonError(value);

	t.is(error.message, 'Non-error value was thrown');
	t.is(error.value, value);
});

test('NonError falls back to the default message when reading `message` throws', t => {
	const value = {
		get message(): string {
			throw new Error('Getter exploded');
		},
	};

	const error = new NonError(value);

	t.is(error.message, 'Non-error value was thrown');
	t.is(error.value, value);
});

test('NonError.wrap returns any Error as-is, including one from another realm and a DOMException', t => {
	const nonError = new NonError('already wrapped');

	for (const error of [
		new TypeError('local'),
		runInNewContext('new Error("foreign")') as Error,
		new DOMException('Aborted', 'AbortError'),
		nonError,
	]) {
		t.is(NonError.wrap(error), error);
	}
});

test('NonError.wrap wraps values that are not errors', t => {
	const object = {message: 'object message'};

	for (const [value, message] of [
		['a string', 'a string'],
		[object, 'object message'],
		[undefined, 'Non-error value was thrown'],
	] as const) {
		const wrapped = NonError.wrap(value);

		t.true(wrapped instanceof NonError);
		t.is((wrapped as NonError).value, value);
		t.is(wrapped.message, message);
	}
});

// ForceRetryError

test('ForceRetryError accepts an infinite delay', t => {
	t.is(new ForceRetryError({delay: Number.POSITIVE_INFINITY}).customDelay, Number.POSITIVE_INFINITY);
});

test('ForceRetryError without a cause has no own `cause` property', t => {
	t.false(Object.hasOwn(new ForceRetryError({code: 'RATE_LIMIT'}), 'cause'));
	t.false(Object.hasOwn(new ForceRetryError(), 'cause'));
});

// HTTPError

test('HTTPError message includes a custom request method', async t => {
	const error = await t.throwsAsync(ky(url, {
		method: 'PROPFIND',
		retry: 0,
		fetch: async () => new Response('', {status: 423, statusText: 'Locked'}),
	}));

	t.true(isHTTPError(error));
	t.is(error?.message, `Request failed with status code 423 Locked: PROPFIND ${url}`);
});

// Other error classes

test('TimeoutError message includes the request method and URL', t => {
	const request = new Request(url, {method: 'DELETE'});
	const error = new TimeoutError(request);

	t.is(error.message, `Request timed out: DELETE ${url}`);
	t.is(error.request, request);
});

test('ResponseSizeError message includes the limit, method, and URL', t => {
	const request = new Request(url, {method: 'POST', body: 'x'});
	const error = new ResponseSizeError(request, 1024);

	t.is(error.message, `Response body exceeded 1024 bytes: POST ${url}`);
	t.is(error.request, request);
	t.is(error.maxResponseSize, 1024);
});

test('KyError is a branded base error with its own name', t => {
	const error = new KyError('Something in Ky failed');

	t.is(error.name, 'KyError');
	t.is(error.message, 'Something in Ky failed');
	t.true(error instanceof Error);
	t.true(isKyError(error));
});

// Type guards

test('type guards require the brand to be exactly `true`', t => {
	for (const brand of [1, 'true', {}]) {
		const error = Object.assign(new Error('Look-alike'), {name: 'HTTPError', isKyError: brand});

		t.false(isHTTPError(error), `brand: ${JSON.stringify(brand)}`);
		t.false(isKyError(error), `brand: ${JSON.stringify(brand)}`);
	}
});

test('isKyError accepts every Ky error class and any value carrying the exact brand', async t => {
	const request = new Request(url);
	const httpError = await t.throwsAsync(ky(url, {
		retry: 0,
		fetch: async () => new Response('', {status: 500}),
	}));

	for (const error of [
		httpError,
		new KyError('base'),
		new NetworkError(request),
		new TimeoutError(request),
		new ResponseSizeError(request, 1),
		new ForceRetryError(),
		// A copy of Ky in another realm or a duplicated dependency is only recognisable by the brand.
		runInNewContext('Object.assign(new Error("foreign"), {isKyError: true})') as Error,
		{isKyError: true},
	]) {
		t.true(isKyError(error), `name: ${String((error as {name?: string}).name)}`);
	}

	for (const value of [new NonError('thrown'), new SchemaValidationError([{message: 'Invalid'}]), {isKyError: 'true'}]) {
		t.false(isKyError(value));
	}
});

test('type guards return false for values that are not objects', t => {
	for (const value of [undefined, 0, '', 'HTTPError', true]) {
		t.false(isKyError(value));
		t.false(isHTTPError(value));
		t.false(isNetworkError(value));
		t.false(isTimeoutError(value));
		t.false(isForceRetryError(value));
		t.false(isResponseSizeError(value));
	}
});

// Raw network error detection

test('recognizes every exact runtime network error message', t => {
	for (const message of [
		'network error',
		'NetworkError when attempting to fetch resource.',
		'The Internet connection appears to be offline.',
		'Network request failed',
		'fetch failed',
		'terminated',
		' A network error occurred.',
		'Network connection lost',
		'Failed to fetch',
	]) {
		t.true(isRawNetworkError(new TypeError(message)), `message: ${JSON.stringify(message)}`);
	}
});

test('does not recognize look-alike network error messages', t => {
	for (const message of [
		'A network error occurred.',
		'Network Error',
		'Fetch failed',
		'fetch failed.',
		'Failed to fetch dynamically imported module: https://example.com/chunk.js',
		'Failed to fetch (example.com',
		'NetworkError',
		'',
	]) {
		t.false(isRawNetworkError(new TypeError(message)), `message: ${JSON.stringify(message)}`);
	}
});

test('recognizes Chrome `Failed to fetch` with a hostname', t => {
	t.true(isRawNetworkError(new TypeError('Failed to fetch (api.example.com)')));
});

test('recognizes a stacked Safari `Load failed` captured by Sentry', t => {
	t.true(isRawNetworkError(Object.assign(new TypeError('Load failed'), {__sentry_captured__: true})));
	t.true(isRawNetworkError(Object.assign(new TypeError('Load failed (api.example.com)'), {__sentry_captured__: true})));
});

test('does not recognize Safari `Load failed` look-alikes without a stack', t => {
	for (const message of ['Load failed (api.example.com', 'Load failed: script error', 'load failed']) {
		t.false(isRawNetworkError(createStacklessTypeError(message)), `message: ${JSON.stringify(message)}`);
	}
});

test('recognizes Deno network errors only by their prefix', t => {
	t.true(isRawNetworkError(new TypeError('error sending request for url (https://example.com/): client error (Connect): tcp connect error: Connection refused (os error 61)')));
	t.false(isRawNetworkError(new TypeError('Upload failed: error sending request for url (https://example.com/)')));
});

// How Ky turns raw fetch errors into `NetworkError`

test('a network TypeError from another realm becomes a NetworkError with that cause', async t => {
	const foreignError = runInNewContext('new TypeError("fetch failed")') as TypeError;
	t.false(foreignError instanceof TypeError);

	const error = await t.throwsAsync(ky(url, {
		retry: 0,
		async fetch() {
			throw foreignError;
		},
	}), {instanceOf: NetworkError});

	t.is(error?.cause, foreignError);
});

test('a NetworkError from a body read reports the request that was sent', async t => {
	let sent: Request | undefined;
	const cause = new TypeError('terminated');

	const error = await t.throwsAsync(ky(url, {
		retry: {limit: 1, delay: () => 0},
		async fetch(request) {
			sent = request as Request;
			return new Response(new ReadableStream({
				start(controller) {
					controller.error(cause);
				},
			}));
		},
	}).text(), {instanceOf: NetworkError});

	t.is(error?.request, sent);
	t.is(error?.cause, cause);
});

// `beforeError` processing

test('`beforeError` hooks pass a replacement along and a non-Error result does not undo it', async t => {
	const replacement = new Error('Replaced');
	const seen: Error[] = [];

	const error = await t.throwsAsync(ky(url, {
		retry: 0,
		fetch: async () => new Response('', {status: 500}),
		hooks: {
			beforeError: [
				() => replacement,
				({error}) => {
					seen.push(error);
					return 'not an error' as never;
				},
				({error}) => {
					seen.push(error);
				},
			],
		},
	}));

	t.is(error, replacement);
	t.deepEqual(seen, [replacement, replacement]);
});

// `delay`

test('delay rejects with the reason of an already aborted signal', async t => {
	const reason = new Error('Already aborted');

	const error = await t.throwsAsync(delay(0, {signal: AbortSignal.abort(reason)}));

	t.is(error, reason);
});
