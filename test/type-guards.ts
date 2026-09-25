import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import ky, {
	HTTPError,
	NetworkError,
	ForceRetryError,
	SchemaValidationError,
	TimeoutError,
	isKyError,
	isHTTPError,
	isNetworkError,
	isTimeoutError,
	isForceRetryError,
} from '../source/index.js';

test('error names can be customized without changing instance type guards', async t => {
	const request = new Request('https://example.com');
	const httpError = await t.throwsAsync(ky(request, {
		retry: 0,
		fetch: async () => new Response('Forbidden', {status: 403}),
	}), {instanceOf: HTTPError});

	for (const [error, guard] of [
		[httpError, isHTTPError],
		[new NetworkError(request), isNetworkError],
		[new TimeoutError(request), isTimeoutError],
		[new ForceRetryError(), isForceRetryError],
	] as const) {
		t.is(error.name, error.constructor.name);
		error.name = 'CustomError';
		t.true(error.toString().startsWith('CustomError: '));
		t.true(guard(error));
		t.true(isKyError(error));
	}

	const validationError = new SchemaValidationError([{message: 'Invalid response'}]);
	t.is(validationError.name, 'SchemaValidationError');
	validationError.name = 'InvalidResponseError';
	t.true(validationError.toString().startsWith('InvalidResponseError: '));
	t.true(validationError instanceof SchemaValidationError);
	t.false(isKyError(validationError));
});

test('AbortSignal.timeout errors are not Ky errors', async t => {
	const signal = AbortSignal.timeout(0);
	await delay(10);

	t.true(signal.aborted);
	t.true(signal.reason instanceof DOMException);
	t.is(signal.reason.name, 'TimeoutError');
	t.false(isTimeoutError(signal.reason));
	t.false(isKyError(signal.reason));
});

test('Ky timeout errors are recognized', t => {
	const error = new TimeoutError(new Request('https://example.com'));

	t.true(isTimeoutError(error));
	t.true(isKyError(error));
});

for (const [name, guard] of [
	['HTTPError', isHTTPError],
	['NetworkError', isNetworkError],
	['TimeoutError', isTimeoutError],
	['ForceRetryError', isForceRetryError],
] as const) {
	test(`${name} guard rejects unrelated errors with the same name`, t => {
		const error = new Error('Not from Ky');
		error.name = name;

		t.false(guard(error));
		t.false(isKyError(error));
	});

	test(`${name} guard recognizes branded errors from another Ky constructor`, t => {
		const error = Object.assign(new Error('From another Ky constructor'), {
			name,
			isKyError: true,
		});

		t.true(guard(error));
		t.true(isKyError(error));
	});
}

// Ky ships `isForceRetryError()` for cross-realm use, but its own retry logic used `instanceof`, so a `ForceRetryError` from a second copy of Ky was silently never retried.
test('a branded ForceRetryError from another Ky copy still forces a retry', async t => {
	let attempts = 0;
	const branded = Object.assign(new Error('From another Ky constructor'), {
		name: 'ForceRetryError',
		isKyError: true,
	});

	const text = await ky('https://example.com', {
		async fetch() {
			attempts++;
			if (attempts === 1) {
				throw branded;
			}

			return new Response('retried');
		},
		retry: {limit: 1, delay: () => 0},
	}).text();

	t.is(attempts, 2);
	t.is(text, 'retried');
});

// The brand check accepts any object that claims to be an `HTTPError`, so the retry path must not assume the cross-realm shape also carries a `response`.
test('a branded HTTPError without a response is not retried as an HTTPError', async t => {
	let attempts = 0;
	const branded = Object.assign(new Error('From another Ky constructor'), {
		name: 'HTTPError',
		isKyError: true,
	});

	const error = await t.throwsAsync(ky('https://example.com', {
		async fetch() {
			attempts++;
			throw branded;
		},
		retry: {limit: 1, delay: () => 0},
	}).text());

	t.is(attempts, 1);
	t.is(error, branded);
});
