import test from 'ava';
import ky from '../source/index.js';

const lateRetryDecision = test.macro(async (t, approval: boolean | undefined, failure: Error) => {
	const controller = new AbortController();
	const reason = new Error('cancelled');
	const decisionStarted = Promise.withResolvers<void>();
	const decision = Promise.withResolvers<boolean | undefined>();
	let attempts = 0;
	let retryHookCalls = 0;
	const errors: Error[] = [];
	const pending = ky('https://example.com', {
		signal: controller.signal,
		retry: {
			limit: 1,
			delay: () => 0,
			async shouldRetry() {
				decisionStarted.resolve();
				return decision.promise;
			},
		},
		async fetch() {
			attempts++;
			throw failure;
		},
		hooks: {
			beforeRetry: [() => {
				retryHookCalls++;
			}],
			beforeError: [({error}) => {
				errors.push(error);
				return error;
			}],
		},
	});
	const rejection = t.throwsAsync(pending, {is: reason});

	await decisionStarted.promise;
	controller.abort(reason);
	decision.resolve(approval);
	await rejection;

	t.is(attempts, 1);
	t.is(retryHookCalls, 0);
	t.deepEqual(errors, [reason]);
});

for (const approval of [true, false, undefined]) {
	for (const failure of [new TypeError('fetch failed'), new Error('custom failure')]) {
		test(`a late shouldRetry ${approval} decision preserves cancellation after ${failure.message}`, lateRetryDecision, approval, failure);
	}
}

test('cancellation prevents forced retry delay and hooks', async t => {
	const controller = new AbortController();
	const reason = new Error('cancelled');
	let attempts = 0;
	await t.throwsAsync(ky('https://example.com', {
		signal: controller.signal,
		retry: {
			delay() {
				t.fail('Cancelled requests must not calculate a retry delay');
				return 0;
			},
		},
		async fetch() {
			attempts++;
			return new Response('ok');
		},
		hooks: {
			afterResponse: [() => {
				controller.abort(reason);
				return ky.retry();
			}],
			beforeRetry: [() => {
				t.fail('Cancelled requests must not run retry hooks');
			}],
		},
	}), {is: reason});

	t.is(attempts, 1);
});

test('a non-cancellation error still runs shouldRetry', async t => {
	let decisions = 0;
	let attempts = 0;
	const response = await ky('https://example.com', {
		retry: {
			delay: () => 0,
			shouldRetry() {
				decisions++;
				return true;
			},
		},
		async fetch() {
			attempts++;
			if (attempts === 1) {
				throw new Error('temporary custom error');
			}

			return new Response('ok');
		},
	}).text();

	t.is(response, 'ok');
	t.is(decisions, 1);
	t.is(attempts, 2);
});

for (const reason of [new Error('cancelled'), new DOMException('cancelled', 'AbortError')]) {
	test(`user cancellation bypasses retry decisions for ${reason.name}`, async t => {
		const controller = new AbortController();
		let decisions = 0;
		const errors: Error[] = [];
		await t.throwsAsync(ky('https://example.com', {
			signal: controller.signal,
			retry: {
				shouldRetry() {
					decisions++;
					throw new Error('retry decision should not run after cancellation');
				},
			},
			async fetch() {
				controller.abort(reason);
				throw reason;
			},
			hooks: {
				beforeError: [({error}) => {
					errors.push(error);
					return error;
				}],
			},
		}), {is: reason});

		t.is(decisions, 0);
		t.deepEqual(errors, [reason]);
	});
}
