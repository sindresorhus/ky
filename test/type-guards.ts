import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import {
	TimeoutError,
	isKyError,
	isHTTPError,
	isNetworkError,
	isTimeoutError,
	isForceRetryError,
} from '../source/index.js';

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
