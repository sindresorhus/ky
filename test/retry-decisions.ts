import test, {type ExecutionContext} from 'ava';
import ky, {HTTPError} from '../source/index.js';
import {NonError} from '../source/errors/NonError.js';

// Ky bounds every HTTP error body read with this timer, even when `timeout` is `false`.
const errorBodyReadTimeout = 10_000;

/*
Replaces `setTimeout` until the test ends, so the retry delays Ky schedules are recorded and then run at once.

The tests that use this set `timeout: false`, so the only other timer is the error body read timer, which is not recorded.
*/
const captureRetryDelays = (t: ExecutionContext): number[] => {
	const originalSetTimeout = globalThis.setTimeout;
	const retryDelays: number[] = [];

	globalThis.setTimeout = ((handler: () => void, milliseconds?: number) => {
		if (milliseconds === errorBodyReadTimeout) {
			return originalSetTimeout(handler, milliseconds);
		}

		retryDelays.push(milliseconds ?? 0);
		return originalSetTimeout(handler, 0);
	}) as typeof globalThis.setTimeout;

	t.teardown(() => {
		globalThis.setTimeout = originalSetTimeout;
	});

	return retryDelays;
};

/*
Creates a `fetch` that responds with the next response from the list and repeats the last one.
*/
const createFetch = (...createResponses: Array<() => Response>) => {
	const state = {
		requestCount: 0,
		async fetch() {
			const createResponse = createResponses[Math.min(state.requestCount, createResponses.length - 1)]!;
			state.requestCount++;
			return createResponse();
		},
	};

	return state;
};

const status = (statusCode: number, headers?: HeadersInit) => () => new Response(undefined, {status: statusCode, headers});
const success = () => new Response('ok');

/*
Creates an `afterResponse` hook that returns the given forced retry for the first response only.
*/
const forceRetryOnce = (createForcedRetry: () => ReturnType<typeof ky.retry>) => {
	let forcedRetry = false;

	return () => {
		if (!forcedRetry) {
			forcedRetry = true;
			return createForcedRetry();
		}
	};
};

test.serial('a jitter function returning zero gives no delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(500), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 100,
			jitter: () => 0,
		},
	});

	t.deepEqual(retryDelays, [0]);
});

test.serial('a `retry.delay` of Infinity is accepted and capped by backoffLimit', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(500), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => Number.POSITIVE_INFINITY,
			backoffLimit: 1000,
		},
	});

	t.deepEqual(retryDelays, [1000]);
});

test.serial('a 429 response without a retry timing header uses the computed delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(429), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 100,
		},
	});

	t.deepEqual(retryDelays, [100]);
});

test.serial('`ky.retry({delay})` bypasses jitter and backoffLimit', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			backoffLimit: 10,
			jitter: () => 1,
		},
		hooks: {
			afterResponse: [forceRetryOnce(() => ky.retry({delay: 500}))],
		},
	});

	t.deepEqual(retryDelays, [500]);
});

test.serial('`ky.retry({delay: 0})` retries without the computed delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 5000,
		},
		hooks: {
			afterResponse: [forceRetryOnce(() => ky.retry({delay: 0}))],
		},
	});

	t.deepEqual(retryDelays, [0]);
});

test.serial('`ky.retry()` without a delay applies jitter and backoffLimit to the computed delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 100,
			jitter: delay => delay / 2,
			backoffLimit: 30,
		},
		hooks: {
			afterResponse: [forceRetryOnce(() => ky.retry())],
		},
	});

	t.deepEqual(retryDelays, [30]);
});

test('a 413 response is not retried when its status is missing from afterStatusCodes, even with Retry-After', async t => {
	const state = createFetch(status(413, {'Retry-After': '0'}), success);

	await t.throwsAsync(ky('https://example.com', {
		fetch: state.fetch,
		retry: {
			limit: 1,
			afterStatusCodes: [429],
		},
	}), {instanceOf: HTTPError});

	t.is(state.requestCount, 1);
});

test('the method of a request replaced in beforeRetry decides whether it is retried again', async t => {
	const methods: string[] = [];

	await t.throwsAsync(ky('https://example.com', {
		async fetch(request) {
			methods.push((request as Request).method);
			return new Response(undefined, {status: 500});
		},
		retry: {
			limit: 3,
			delay: () => 0,
		},
		hooks: {
			beforeRetry: [({request}) => new Request(request, {method: 'POST'})],
		},
	}), {instanceOf: HTTPError});

	t.deepEqual(methods, ['GET', 'POST']);
});

test('shouldRetry returning a truthy non-boolean does not force a retry', async t => {
	const state = createFetch(status(404), success);

	await t.throwsAsync(ky('https://example.com', {
		fetch: state.fetch,
		retry: {
			limit: 1,
			delay: () => 0,
			shouldRetry: () => 1 as never,
		},
	}), {instanceOf: HTTPError});

	t.is(state.requestCount, 1);
});

test('shouldRetry returning a falsy non-boolean does not prevent a retry', async t => {
	const state = createFetch(status(500), success);

	t.is(await ky('https://example.com', {
		fetch: state.fetch,
		retry: {
			limit: 1,
			delay: () => 0,
			shouldRetry: () => 0 as never,
		},
	}).text(), 'ok');

	t.is(state.requestCount, 2);
});

test('shouldRetry is not called for a method that is not retried', async t => {
	const state = createFetch(status(500), success);
	let shouldRetryCallCount = 0;

	await t.throwsAsync(ky.post('https://example.com', {
		fetch: state.fetch,
		retry: {
			limit: 1,
			delay: () => 0,
			shouldRetry() {
				shouldRetryCallCount++;
				return true;
			},
		},
	}), {instanceOf: HTTPError});

	t.is(shouldRetryCallCount, 0);
	t.is(state.requestCount, 1);
});

test('a non-Error value thrown by fetch reaches shouldRetry as a NonError and is not retried by default', async t => {
	let requestCount = 0;
	const shouldRetryErrors: Error[] = [];

	const error = await t.throwsAsync(ky('https://example.com', {
		async fetch() {
			requestCount++;
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw 'temporary failure';
		},
		retry: {
			limit: 1,
			delay: () => 0,
			shouldRetry({error}) {
				shouldRetryErrors.push(error);
				return undefined;
			},
		},
	}), {any: true});

	t.is(error, 'temporary failure');
	t.is(requestCount, 1);
	t.is(shouldRetryErrors.length, 1);
	t.true(shouldRetryErrors[0] instanceof NonError);
	t.is((shouldRetryErrors[0] as NonError).value, 'temporary failure');
});

// `setTimeout()` treats a delay above 2^31 - 1 as 1ms, so an unbounded delay must be capped rather than turning into an immediate retry.
test.serial('an infinite `retry.delay` without totalTimeout is capped at the largest timer delay and still retries', async t => {
	const retryDelays = captureRetryDelays(t);
	const state = createFetch(status(500), success);

	t.is(await ky('https://example.com', {
		fetch: state.fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => Number.POSITIVE_INFINITY,
			backoffLimit: Number.POSITIVE_INFINITY,
		},
	}).text(), 'ok');

	t.deepEqual(retryDelays, [2_147_483_647]);
	t.is(state.requestCount, 2);
});

test.serial('`ky.retry({delay: Infinity})` is capped at the largest timer delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const state = createFetch(success);

	t.is(await ky('https://example.com', {
		fetch: state.fetch,
		timeout: false,
		retry: {
			limit: 1,
			backoffLimit: 10,
		},
		hooks: {
			afterResponse: [forceRetryOnce(() => ky.retry({delay: Number.POSITIVE_INFINITY}))],
		},
	}).text(), 'ok');

	t.deepEqual(retryDelays, [2_147_483_647]);
	t.is(state.requestCount, 2);
});

test.serial('a Retry-After with more digits than a number can hold is capped at the largest timer delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(503, {'Retry-After': '9'.repeat(400)}), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 100,
		},
	});

	t.deepEqual(retryDelays, [2_147_483_647]);
});

test.serial('`maxRetryAfter: 0` retries at once even when the server asks to wait', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(503, {'Retry-After': '30'}), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 100,
			maxRetryAfter: 0,
		},
	});

	t.deepEqual(retryDelays, [0]);
});

test.serial('`maxRetryAfter` caps a RateLimit-Reset delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(429, {'RateLimit-Reset': '30'}), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 100,
			maxRetryAfter: 1000,
		},
	});

	t.deepEqual(retryDelays, [1000]);
});

test.serial('`backoffLimit: 0` retries without a delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(500), status(500), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 2,
			backoffLimit: 0,
		},
	});

	t.deepEqual(retryDelays, [0, 0]);
});

test.serial('a jitter function returning Infinity falls back to the computed delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(500), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 100,
			jitter: () => Number.POSITIVE_INFINITY,
		},
	});

	t.deepEqual(retryDelays, [100]);
});

// A 500 is not in the default `afterStatusCodes`, so its Retry-After is not a server instruction Ky follows.
test.serial('a Retry-After on a status missing from afterStatusCodes is ignored in favor of the computed delay', async t => {
	const retryDelays = captureRetryDelays(t);
	const {fetch} = createFetch(status(500, {'Retry-After': '30'}), success);

	await ky('https://example.com', {
		fetch,
		timeout: false,
		retry: {
			limit: 1,
			delay: () => 100,
		},
	});

	t.deepEqual(retryDelays, [100]);
});
