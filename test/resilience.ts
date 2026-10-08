import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import ky, {
	HTTPError,
	NetworkError,
	TimeoutError,
	type Options,
} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

/*
Scenarios adapted from the HTTP resilience comparison at https://fetchkit.org/http-resilience/

Every cancellation and deadline test checks the same contract:
- The caller settles promptly, not when the wait would have ended.
- Nothing reaches the transport after the cancellation.
- A hung attempt sees its signal aborted.
- The next request on the same instance still works.
*/

const url = 'https://example.com/resource';

type Step =
	| {status?: number; body?: string; headers?: HeadersInit}
	| 'hang'
	| Error;

// A fetch that serves `steps` in order, records what each attempt sent, and fails loudly on an unexpected attempt. Every call counts as an attempt, even one with an aborted signal, so a stray dispatch after a cancellation is visible.
function scriptedFetch(steps: Step[]) {
	const transport = {
		attempts: 0,
		active: 0,
		aborted: 0,
		requests: [] as Request[],
		bodies: [] as string[],
		async fetch(input: RequestInfo | URL): Promise<Response> {
			if (!(input instanceof Request)) {
				throw new TypeError('Expected Ky to call fetch with a Request');
			}

			const step = steps[transport.attempts++];
			transport.requests.push(input);

			// Like native fetch, an aborted signal rejects before anything is sent.
			input.signal.throwIfAborted();

			transport.active++;

			try {
				transport.bodies.push(input.body ? await input.text() : '');

				if (step === undefined) {
					throw new Error(`Unexpected attempt ${transport.attempts}`);
				}

				if (step === 'hang') {
					if (!input.signal.aborted) {
						await once(input.signal, 'abort');
					}

					transport.aborted++;
					input.signal.throwIfAborted();
				}

				if (step instanceof Error) {
					throw step;
				}

				const {status = 200, body = '', headers = {}} = step as Exclude<Step, 'hang' | Error>;
				return new Response(body, {status, headers});
			} finally {
				transport.active--;
			}
		},
	};

	return transport;
}

// Tracks a promise without awaiting it, so a test can check whether it has settled yet.
function observe<T>(promise: Promise<T>) {
	const state: {settled: boolean; value?: T; error?: unknown} = {settled: false};
	void (async () => {
		try {
			state.value = await promise;
		} catch (error) {
			state.error = error;
		} finally {
			state.settled = true;
		}
	})();

	return state;
}

const busy = (body = 'busy'): Step => ({status: 503, body});
const ready = (body = 'ready'): Step => ({body});
const networkError = () => new TypeError('fetch failed');

// Options shared by the scripted scenarios: fixed delays, no jitter, and no per-attempt timeout unless a test sets one.
function client(transport: ReturnType<typeof scriptedFetch>, options: Options = {}) {
	return ky.create({
		fetch: transport.fetch,
		timeout: false,
		...options,
		retry: {
			limit: 2,
			delay: () => 20,
			jitter: false,
			...(typeof options.retry === 'object' ? options.retry : {}),
		},
	});
}

// Basic retry contract

test('recovers after two 503 responses with exactly three attempts and no later dispatch', async t => {
	const transport = scriptedFetch([busy(), busy(), ready()]);

	t.is(await client(transport)(url).text(), 'ready');
	t.is(transport.attempts, 3);

	await delay(100);
	t.is(transport.attempts, 3);
	t.is(transport.active, 0);
});

test('retry exhaustion rejects with the response of the last attempt', async t => {
	const transport = scriptedFetch([busy('busy-1'), busy('busy-2'), busy('busy-3')]);

	const error = await t.throwsAsync(client(transport)(url).text(), {instanceOf: HTTPError});
	t.is(error.response.status, 503);
	t.is(error.data, 'busy-3');
	t.is(transport.attempts, 3);

	await delay(100);
	t.is(transport.attempts, 3);
});

test('retry: 0 makes exactly one attempt and rejects with its response', async t => {
	const transport = scriptedFetch([busy('only')]);

	const error = await t.throwsAsync(client(transport, {retry: {limit: 0}})(url).text(), {instanceOf: HTTPError});
	t.is(error.data, 'only');
	t.is(transport.attempts, 1);

	await delay(100);
	t.is(transport.attempts, 1);
});

test('recovers after two network errors with exactly three attempts', async t => {
	const transport = scriptedFetch([networkError(), networkError(), ready()]);

	t.is(await client(transport)(url).text(), 'ready');
	t.is(transport.attempts, 3);
});

test('recovers across different failure kinds in one retry sequence', async t => {
	const transport = scriptedFetch([busy(), networkError(), {status: 500}, {status: 429}, ready()]);

	t.is(await client(transport, {retry: {limit: 4}})(url).text(), 'ready');
	t.is(transport.attempts, 5);
});

test('exhaustion after a network error rejects with a NetworkError that keeps the last raw error', async t => {
	const last = networkError();
	const transport = scriptedFetch([busy(), networkError(), last]);

	const error = await t.throwsAsync(client(transport)(url), {instanceOf: NetworkError});
	t.is(error.cause, last);
	t.is(transport.attempts, 3);
});

test('an exhausted request does not affect the next request on the same instance', async t => {
	const transport = scriptedFetch([busy(), busy(), busy(), ready('next')]);
	const api = client(transport);

	await t.throwsAsync(api(url), {instanceOf: HTTPError});
	t.is(await api(url).text(), 'next');
	t.is(transport.attempts, 4);
});

test('every attempt reaches the transport with the same method, URL and headers', async t => {
	const transport = scriptedFetch([busy(), networkError(), ready()]);

	await client(transport)(url, {headers: {'x-trace': 'abc'}, searchParams: {page: 2}});

	t.is(transport.requests.length, 3);
	for (const request of transport.requests) {
		t.is(request.method, 'GET');
		t.is(request.url, `${url}?page=2`);
		t.is(request.headers.get('x-trace'), 'abc');
	}
});

test('every attempt gets its own Request with an unaborted signal', async t => {
	const transport = scriptedFetch([busy(), busy(), ready()]);

	await client(transport)(url);

	const [first, second, third] = transport.requests;
	t.not(first, second);
	t.not(second, third);
	for (const request of transport.requests) {
		t.false(request.signal.aborted);
	}
});

// Retry + abort during backoff

test('aborting during the backoff settles promptly with the abort reason and dispatches nothing more', async t => {
	const transport = scriptedFetch([busy(), ready('healthy'), ready('healthy')]);
	const api = client(transport, {retry: {delay: () => 1000}});
	const controller = new AbortController();

	const result = observe(api(url, {signal: controller.signal}).text());
	await delay(20);
	controller.abort();
	await delay(50);

	t.true(result.settled, 'Cancellation must settle during the backoff');
	t.is(result.error, controller.signal.reason);

	await delay(1100);
	t.is(transport.attempts, 1, 'No dispatch after cancellation');

	t.is(await api(url).text(), 'healthy');
	t.is(transport.attempts, 2);
	t.is(transport.active, 0);
});

test('aborting during the default exponential backoff settles promptly', async t => {
	const transport = scriptedFetch([busy()]);
	const controller = new AbortController();

	// The first default delay is 300ms.
	const result = observe(ky(url, {
		fetch: transport.fetch, timeout: false, retry: {limit: 2, jitter: false}, signal: controller.signal,
	}).text());
	await delay(20);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);

	await delay(400);
	t.is(transport.attempts, 1);
});

test('aborting during the second backoff stops after two attempts', async t => {
	const transport = scriptedFetch([busy(), busy(), ready()]);
	const controller = new AbortController();
	const api = client(transport, {retry: {delay: attemptCount => attemptCount === 1 ? 10 : 1000}});

	const result = observe(api(url, {signal: controller.signal}));
	await delay(100);
	t.is(transport.attempts, 2);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);

	await delay(1000);
	t.is(transport.attempts, 2);
});

test('aborting during the backoff after a network error rejects with the abort reason, not a NetworkError', async t => {
	const transport = scriptedFetch([networkError()]);
	const controller = new AbortController();

	const result = observe(client(transport, {retry: {delay: () => 1000}})(url, {signal: controller.signal}));
	await delay(20);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);
	t.is(transport.attempts, 1);
});

test('aborting during the backoff after a timed out attempt rejects with the abort reason', async t => {
	const transport = scriptedFetch(['hang']);
	const controller = new AbortController();

	const result = observe(client(transport, {
		timeout: 30,
		retry: {retryOnTimeout: true, delay: () => 1000},
	})(url, {signal: controller.signal}));
	await delay(100);
	t.is(transport.aborted, 1, 'The per-attempt timeout must abort the hung attempt');
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);

	await delay(1000);
	t.is(transport.attempts, 1);
	t.is(transport.active, 0);
});

test('a non-Error abort reason during the backoff reaches the caller unchanged', async t => {
	const transport = scriptedFetch([busy()]);
	const controller = new AbortController();

	const result = observe(client(transport, {retry: {delay: () => 1000}})(url, {signal: controller.signal}));
	await delay(20);
	controller.abort('gave up');
	await delay(50);

	t.true(result.settled);
	t.is(result.error, 'gave up');
	t.is(transport.attempts, 1);
});

test('an AbortSignal.timeout() caller signal ends the backoff with its own TimeoutError', async t => {
	const transport = scriptedFetch([busy()]);
	const signal = AbortSignal.timeout(50);

	const result = observe(client(transport, {retry: {delay: () => 1000}})(url, {signal}));
	await delay(150);

	t.true(result.settled);
	t.is(result.error, signal.reason);
	t.false(result.error instanceof TimeoutError, 'A caller deadline is not a Ky timeout');
	t.is((result.error as DOMException).name, 'TimeoutError');
	t.is(transport.attempts, 1);
});

test('a signal from the instance defaults ends the backoff', async t => {
	const transport = scriptedFetch([busy()]);
	const controller = new AbortController();
	const api = client(transport, {retry: {delay: () => 1000}, signal: controller.signal});

	const result = observe(api(url));
	await delay(20);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);
	t.is(transport.attempts, 1);
});

test('a signal on a Request input ends the backoff', async t => {
	const transport = scriptedFetch([busy()]);
	const controller = new AbortController();

	const result = observe(client(transport, {retry: {delay: () => 1000}})(new Request(url, {signal: controller.signal})));
	await delay(20);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);
	t.is(transport.attempts, 1);
});

test('aborting during the backoff does not run beforeRetry hooks', async t => {
	const transport = scriptedFetch([busy()]);
	const controller = new AbortController();
	let beforeRetryCalls = 0;

	const result = observe(client(transport, {
		retry: {delay: () => 200},
		hooks: {
			beforeRetry: [() => {
				beforeRetryCalls++;
			}],
		},
	})(url, {signal: controller.signal}));
	await delay(20);
	controller.abort();
	await delay(300);

	t.true(result.settled);
	t.is(beforeRetryCalls, 0);
	t.is(transport.attempts, 1);
});

test('aborting during the backoff reaches beforeError hooks as the abort reason', async t => {
	const transport = scriptedFetch([busy()]);
	const controller = new AbortController();
	const seen: unknown[] = [];

	const result = observe(client(transport, {
		retry: {delay: () => 1000},
		hooks: {
			beforeError: [({error}) => {
				seen.push(error);
				return error;
			}],
		},
	})(url, {signal: controller.signal}));
	await delay(20);
	controller.abort(new Error('cancelled'));
	await delay(50);

	t.true(result.settled);
	t.deepEqual(seen, [controller.signal.reason]);
	t.is(result.error, controller.signal.reason);
});

test('aborting one request during its backoff does not affect a concurrent request on the same instance', async t => {
	const transport = scriptedFetch([busy(), busy(), ready('second')]);
	const api = client(transport, {retry: {delay: () => 150}});
	const controller = new AbortController();

	const first = observe(api(url, {signal: controller.signal}).text());
	const second = api(url).text();
	await delay(20);
	controller.abort();
	await delay(50);

	t.true(first.settled);
	t.is(first.error, controller.signal.reason);
	t.is(await second, 'second');

	await delay(200);
	t.is(transport.attempts, 3);
});

test('aborting many concurrent requests during their backoff leaves nothing running', async t => {
	const count = 20;
	const transport = scriptedFetch(Array.from({length: count}, () => busy()));
	const api = client(transport, {retry: {delay: () => 1000}});
	const controller = new AbortController();

	const results = Array.from({length: count}, () => observe(api(url, {signal: controller.signal})));
	await delay(50);
	t.is(transport.attempts, count);
	controller.abort();
	await delay(50);

	for (const result of results) {
		t.true(result.settled);
		t.is(result.error, controller.signal.reason);
	}

	await delay(1000);
	t.is(transport.attempts, count);
	t.is(transport.active, 0);
});

test('an already aborted signal rejects with its reason and is not retried', async t => {
	const transport = scriptedFetch([ready()]);
	const controller = new AbortController();
	controller.abort();

	const error = await t.throwsAsync(client(transport)(url, {signal: controller.signal}));
	t.is(error, controller.signal.reason);

	// Ky leaves the aborted signal to fetch, which rejects before sending anything.
	await delay(100);
	t.is(transport.attempts, 1);
});

test('aborting during a hung attempt aborts that attempt and does not retry', async t => {
	const transport = scriptedFetch(['hang', ready()]);
	const controller = new AbortController();

	const result = observe(client(transport)(url, {signal: controller.signal}));
	await delay(20);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);
	t.is(transport.aborted, 1);
	t.is(transport.active, 0);

	await delay(100);
	t.is(transport.attempts, 1);
});

test('aborting during a hung retry aborts that attempt and does not retry again', async t => {
	const transport = scriptedFetch([busy(), 'hang', ready()]);
	const controller = new AbortController();

	const result = observe(client(transport)(url, {signal: controller.signal}));
	// Wait for the retry to start, since a busy machine can stretch the retry delay.
	while (transport.attempts < 2) {
		// eslint-disable-next-line no-await-in-loop
		await delay(5);
	}

	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);
	t.is(transport.aborted, 1);
	t.is(transport.active, 0);

	await delay(100);
	t.is(transport.attempts, 2);
});

// Retry + total timeout

test('totalTimeout expiring during the backoff rejects at the deadline and never dispatches the retry', async t => {
	const transport = scriptedFetch([busy(), ready('healthy')]);
	const api = client(transport, {totalTimeout: 300, retry: {limit: 1, delay: () => 1000}});

	const result = observe(api(url));
	await delay(150);
	t.false(result.settled, 'The deadline must not fire early');
	await delay(300);

	t.true(result.settled, 'The deadline must cover the backoff');
	t.true(result.error instanceof TimeoutError);

	await delay(700);
	t.is(transport.attempts, 1, 'No dispatch after the deadline');

	t.is(await api(url).text(), 'healthy');
	t.is(transport.attempts, 2);
});

test('totalTimeout expiring during a hung retry aborts that attempt', async t => {
	const transport = scriptedFetch([busy(), 'hang', ready('healthy')]);
	const api = client(transport, {totalTimeout: 300, retry: {limit: 1, delay: () => 20}});

	const result = observe(api(url));
	await delay(150);
	t.false(result.settled);
	t.is(transport.attempts, 2);
	await delay(300);

	t.true(result.settled);
	t.true(result.error instanceof TimeoutError);
	t.is(transport.aborted, 1, 'The hung attempt must be aborted');
	t.is(transport.active, 0);

	await delay(100);
	t.is(transport.attempts, 2);

	t.is(await api(url).text(), 'healthy');
});

test('totalTimeout aborts a hung first attempt when the per-attempt timeout is disabled', async t => {
	const transport = scriptedFetch(['hang']);

	const error = await t.throwsAsync(client(transport, {totalTimeout: 300})(url), {instanceOf: TimeoutError});
	t.is(error.request.url, url);
	await delay(10);
	t.is(transport.attempts, 1);
	t.is(transport.aborted, 1);
	t.is(transport.active, 0);
});

test('each request on an instance gets a fresh totalTimeout budget', async t => {
	const transport = scriptedFetch([busy(), ready('one'), busy(), ready('two')]);
	const api = client(transport, {totalTimeout: 500, retry: {delay: () => 120}});

	t.is(await api(url).text(), 'one');
	// A shared budget would be spent by now.
	await delay(400);
	t.is(await api(url).text(), 'two');
	t.is(transport.attempts, 4);
});

test('totalTimeout aborts every hung attempt under per-attempt timeouts and retryOnTimeout', async t => {
	const transport = scriptedFetch(['hang', 'hang', 'hang', 'hang']);
	// The deadline is not a multiple of the 50ms attempt cycle, so it never ties with an attempt starting.
	const api = client(transport, {timeout: 40, totalTimeout: 175, retry: {limit: 10, retryOnTimeout: true, delay: () => 10}});

	await t.throwsAsync(api(url), {instanceOf: TimeoutError});
	await delay(10);
	t.is(transport.active, 0);
	t.is(transport.aborted, transport.attempts);

	const {attempts} = transport;
	await delay(100);
	t.is(transport.attempts, attempts);
});

test('per-attempt timeouts with retryOnTimeout abort every hung attempt and stop at the retry limit', async t => {
	const transport = scriptedFetch(['hang', 'hang', 'hang']);

	await t.throwsAsync(client(transport, {timeout: 30, retry: {retryOnTimeout: true}})(url), {instanceOf: TimeoutError});
	await delay(10);
	t.is(transport.attempts, 3);
	t.is(transport.aborted, 3);
	t.is(transport.active, 0);
});

// Retry-After + abort

const retryAfterCases = [
	{
		title: 'delay seconds',
		header: () => '1',
		options: {},
		minimum: 1000,
		maximum: 1000,
	},
	{
		title: 'an HTTP date',
		// HTTP dates have second precision, so the wait lands between one and two seconds.
		header: () => new Date(Date.now() + 2000).toUTCString(),
		options: {},
		minimum: 1000,
		maximum: 2000,
	},
	{
		title: 'a malformed value',
		header: () => 'soon',
		options: {},
		// Falls back to the configured `delay`.
		minimum: 150,
		maximum: 150,
	},
	{
		title: 'a value above maxRetryAfter',
		header: () => '1000',
		options: {maxRetryAfter: 300},
		minimum: 300,
		maximum: 300,
	},
] as const;

for (const {title, header, options, minimum, maximum} of retryAfterCases) {
	test(`Retry-After with ${title} controls the retry delay`, async t => {
		const transport = scriptedFetch([{status: 503, headers: {'Retry-After': header()}}, ready()]);
		const api = client(transport, {
			retry: {
				limit: 1, afterStatusCodes: [503], delay: () => 150, ...options,
			},
		});

		const result = observe(api(url).text());
		// Before the expected delay, and after the 150ms fallback for every case that should not use it.
		await delay(minimum - 50);
		t.is(transport.attempts, 1, 'The retry must wait for the advertised delay');

		await delay(maximum - minimum + 300);
		t.true(result.settled);
		t.is(result.value, 'ready');
		t.is(transport.attempts, 2);
	});

	test(`aborting during a Retry-After wait with ${title} settles promptly and dispatches nothing more`, async t => {
		const transport = scriptedFetch([{status: 503, headers: {'Retry-After': header()}}, ready()]);
		const api = client(transport, {
			retry: {
				limit: 1, afterStatusCodes: [503], delay: () => 150, ...options,
			},
		});
		const controller = new AbortController();

		const result = observe(api(url, {signal: controller.signal}));
		await delay(20);
		controller.abort();
		await delay(50);

		t.true(result.settled, 'Abort must interrupt the header-derived wait');
		t.is(result.error, controller.signal.reason);

		await delay(maximum + 100);
		t.is(transport.attempts, 1, 'No dispatch after the wait is cancelled');
	});
}

test('Retry-After on a status outside afterStatusCodes uses the configured backoff', async t => {
	const transport = scriptedFetch([{status: 503, headers: {'Retry-After': '10'}}, ready()]);
	const api = client(transport, {retry: {limit: 1, afterStatusCodes: [429], delay: () => 50}});

	const result = observe(api(url).text());
	await delay(300);

	t.true(result.settled);
	t.is(result.value, 'ready');
});

// Retry + throwing hooks

// Each hook throws only on its first call, so a follow-up request shows the instance is still usable.
const hookCases: Array<{title: string; options: (throwOnce: () => void) => Options}> = [
	{
		title: 'a synchronous shouldRetry',
		options: throwOnce => ({
			retry: {
				shouldRetry() {
					throwOnce();
					return undefined;
				},
			},
		}),
	},
	{
		title: 'an asynchronous shouldRetry',
		options: throwOnce => ({
			retry: {
				async shouldRetry() {
					await delay(5);
					throwOnce();
					return undefined;
				},
			},
		}),
	},
	{
		title: 'a synchronous beforeRetry hook',
		options: throwOnce => ({
			hooks: {
				beforeRetry: [throwOnce],
			},
		}),
	},
	{
		title: 'an asynchronous beforeRetry hook',
		options: throwOnce => ({
			hooks: {
				beforeRetry: [async () => {
					await delay(5);
					throwOnce();
				}],
			},
		}),
	},
	{
		title: 'retry.delay',
		options: throwOnce => ({
			retry: {
				delay() {
					throwOnce();
					return 20;
				},
			},
		}),
	},
	{
		title: 'retry.jitter',
		options: throwOnce => ({
			retry: {
				jitter(delay) {
					throwOnce();
					return delay;
				},
			},
		}),
	},
];

for (const {title, options} of hookCases) {
	test(`an error thrown from ${title} reaches the caller unchanged and is not retried`, async t => {
		const transport = scriptedFetch([busy(), busy(), ready('healthy')]);
		const sentinel = new Error(`sentinel: ${title}`);
		let armed = true;
		const api = client(transport, options(() => {
			if (armed) {
				armed = false;
				throw sentinel;
			}
		}));

		const result = observe(api(url));
		await delay(200);

		t.true(result.settled, 'A throwing hook must settle the caller');
		t.is(result.error, sentinel);
		t.is(transport.attempts, 1);

		t.is(await api(url).text(), 'healthy');
		t.is(transport.attempts, 3);
	});
}

test('an error thrown from an afterResponse hook on a retryable response is not retried', async t => {
	const transport = scriptedFetch([busy(), ready()]);
	const sentinel = new Error('afterResponse');

	const error = await t.throwsAsync(client(transport, {
		hooks: {
			afterResponse: [() => {
				throw sentinel;
			}],
		},
	})(url));
	t.is(error, sentinel);
	t.is(transport.attempts, 1);
});

test('a beforeRetry hook that throws on the second retry stops after two attempts', async t => {
	const transport = scriptedFetch([busy(), busy(), ready()]);
	const sentinel = new Error('second retry');

	const error = await t.throwsAsync(client(transport, {
		hooks: {
			beforeRetry: [({retryCount}) => {
				if (retryCount === 2) {
					throw sentinel;
				}
			}],
		},
	})(url));
	t.is(error, sentinel);
	t.is(transport.attempts, 2);
});

test('a shouldRetry that throws after a network error reaches the caller unchanged', async t => {
	const transport = scriptedFetch([networkError(), ready()]);
	const sentinel = new Error('shouldRetry');

	const error = await t.throwsAsync(client(transport, {
		retry: {
			shouldRetry() {
				throw sentinel;
			},
		},
	})(url));
	t.is(error, sentinel);
	t.is(transport.attempts, 1);
});

// Retry + body replay

const payload = 'payload: café / 123 🦄';
const bytes = new TextEncoder().encode(payload);

// `expected` is the exact body on the wire and `contentType` its header, left out when there is none. Both are left out for FormData, whose boundary is random.
const bodyCases: Array<{title: string; expected?: string; contentType?: string; send: (transport: ReturnType<typeof scriptedFetch>) => Promise<unknown>}> = [
	{
		title: 'a string',
		contentType: 'text/plain;charset=UTF-8',
		expected: payload,
		send: async transport => client(transport, {retry: {methods: ['post']}}).post(url, {body: payload}),
	},
	{
		title: 'a Uint8Array',
		expected: payload,
		send: async transport => client(transport, {retry: {methods: ['post']}}).post(url, {body: bytes}),
	},
	{
		title: 'an ArrayBuffer',
		expected: payload,
		send: async transport => client(transport, {retry: {methods: ['post']}}).post(url, {body: new TextEncoder().encode(payload).buffer}),
	},
	{
		title: 'a Blob',
		expected: payload,
		send: async transport => client(transport, {retry: {methods: ['post']}}).post(url, {body: new Blob([payload])}),
	},
	{
		title: 'URLSearchParams',
		contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
		expected: new URLSearchParams({payload}).toString(),
		send: async transport => client(transport, {retry: {methods: ['post']}}).post(url, {body: new URLSearchParams({payload})}),
	},
	{
		title: 'FormData',
		async send(transport) {
			const formData = new FormData();
			formData.append('payload', payload);
			formData.append('file', new Blob([bytes]), 'file.txt');
			return client(transport, {retry: {methods: ['post']}}).post(url, {body: formData});
		},
	},
	{
		title: 'json',
		contentType: 'application/json',
		expected: JSON.stringify({payload}),
		send: async transport => client(transport, {retry: {methods: ['post']}}).post(url, {json: {payload}}),
	},
	{
		title: 'a ReadableStream',
		expected: payload,
		send: async transport => client(transport, {retry: {methods: ['post']}}).post(url, {
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(bytes.slice(0, 5));
					controller.enqueue(bytes.slice(5));
					controller.close();
				},
			}),
		}),
	},
	{
		title: 'a Request input with a string body',
		contentType: 'text/plain;charset=UTF-8',
		expected: payload,
		send: async transport => client(transport, {retry: {methods: ['post']}})(new Request(url, {method: 'POST', body: payload})),
	},
	{
		title: 'a Request input with a stream body',
		expected: payload,
		send: async transport => client(transport, {retry: {methods: ['post']}})(new Request(url, {
			method: 'POST',
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				},
			}),
			duplex: 'half',
		} as RequestInit)),
	},
	{
		title: 'a PUT under the default retry methods',
		contentType: 'text/plain;charset=UTF-8',
		expected: payload,
		send: async transport => client(transport).put(url, {body: payload}),
	},
];

for (const {title, expected, contentType, send} of bodyCases) {
	test(`a retry resends ${title} body byte for byte`, async t => {
		const transport = scriptedFetch([busy(), networkError(), ready()]);

		await send(transport);

		t.is(transport.attempts, 3);
		const contentTypes = transport.requests.map(request => request.headers.get('content-type'));
		if (expected === undefined) {
			const boundary = contentTypes[0]?.split('multipart/form-data; boundary=')[1];
			t.truthy(boundary);
			t.true(transport.bodies[0]!.includes(`--${boundary}`), 'The body must use the boundary from the header');
			t.true(transport.bodies[0]!.includes(payload));
		} else {
			t.is(transport.bodies[0], expected);
			t.is(contentTypes[0] ?? undefined, contentType);
		}

		t.deepEqual(transport.bodies, Array.from({length: 3}, () => transport.bodies[0]));
		t.deepEqual(contentTypes, Array.from({length: 3}, () => contentTypes[0]));
	});
}

test('aborting during the backoff of a POST with a stream body dispatches nothing more', async t => {
	const transport = scriptedFetch([busy(), ready()]);
	const controller = new AbortController();

	const result = observe(client(transport, {retry: {methods: ['post'], delay: () => 1000}}).post(url, {
		signal: controller.signal,
		body: new ReadableStream({
			start(streamController) {
				streamController.enqueue(bytes);
				streamController.close();
			},
		}),
	}));
	await delay(20);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);

	await delay(1000);
	t.deepEqual(transport.bodies, [payload]);
});

// Real HTTP

// Waits for `promise`, failing instead of hanging when it takes longer than two seconds.
async function withinTwoSeconds<T>(promise: Promise<T>, message: string): Promise<T> {
	const timeout = delay(2000, undefined, {ref: false}).then(() => {
		throw new Error(message);
	});

	return Promise.race([promise, timeout]);
}

test('retry over real HTTP recovers after two 503 responses', async t => {
	const server = await createHttpTestServer(t);
	const arrivals: string[] = [];
	server.get('/flaky', (request, response) => {
		arrivals.push(request.url);
		if (arrivals.length < 3) {
			response.sendStatus(503);
			return;
		}

		response.end('ready');
	});

	t.is(await ky(`${server.url}/flaky`, {retry: {limit: 2, delay: () => 5}}).text(), 'ready');
	t.deepEqual(arrivals, ['/flaky', '/flaky', '/flaky']);
});

test('a timeout over real HTTP closes the hung connection and the next request still works', async t => {
	const server = await createHttpTestServer(t);
	const {promise: closed, resolve: markClosed} = Promise.withResolvers<void>();
	server.get('/slow', (_request, response) => {
		response.once('close', markClosed);
	});
	server.get('/', (_request, response) => {
		response.end('ready');
	});

	await t.throwsAsync(ky(`${server.url}/slow`, {timeout: 100, retry: 0}), {instanceOf: TimeoutError});
	await withinTwoSeconds(closed, 'The hung connection was not closed');
	t.is(await ky(server.url).text(), 'ready');
});

test('a totalTimeout over real HTTP closes the hung retry connection', async t => {
	const server = await createHttpTestServer(t);
	const {promise: closed, resolve: markClosed} = Promise.withResolvers<void>();
	let arrivals = 0;
	server.get('/', (_request, response) => {
		arrivals++;
		if (arrivals === 1) {
			response.sendStatus(503);
			return;
		}

		response.once('close', markClosed);
	});

	await t.throwsAsync(ky(server.url, {timeout: false, totalTimeout: 1000, retry: {limit: 1, delay: () => 20}}), {instanceOf: TimeoutError});
	await withinTwoSeconds(closed, 'The hung retry connection was not closed');
	t.is(arrivals, 2);
});

test('aborting during the backoff over real HTTP makes exactly one arrival', async t => {
	const server = await createHttpTestServer(t);
	const {promise: firstArrival, resolve: markFirstArrival} = Promise.withResolvers<void>();
	let arrivals = 0;
	server.get('/', (_request, response) => {
		arrivals++;
		response.sendStatus(503);
		markFirstArrival();
	});
	const controller = new AbortController();

	const result = observe(ky(server.url, {signal: controller.signal, retry: {limit: 2, delay: () => 1000}}));
	await firstArrival;
	// Let Ky receive the response and start the backoff.
	await delay(100);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);
	await delay(1000);
	t.is(arrivals, 1);
});

test('aborting a hung attempt over real HTTP closes its connection and does not retry', async t => {
	const server = await createHttpTestServer(t);
	const {promise: arrived, resolve: markArrived} = Promise.withResolvers<void>();
	const {promise: closed, resolve: markClosed} = Promise.withResolvers<void>();
	let arrivals = 0;
	server.get('/', (_request, response) => {
		arrivals++;
		response.once('close', markClosed);
		markArrived();
	});
	const controller = new AbortController();

	const result = observe(ky(server.url, {signal: controller.signal, timeout: false, retry: {limit: 2, delay: () => 5}}));
	await arrived;
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);
	await withinTwoSeconds(closed, 'The aborted connection was not closed');
	await delay(100);
	t.is(arrivals, 1);
});

test('aborting while Ky reads a retryable error body over real HTTP settles promptly and does not retry', async t => {
	const server = await createHttpTestServer(t);
	const {promise: arrived, resolve: markArrived} = Promise.withResolvers<void>();
	let arrivals = 0;
	server.get('/', (_request, response) => {
		arrivals++;
		// The error body never ends, so Ky is still reading it when the caller aborts.
		response.writeHead(503, {'content-type': 'text/plain'});
		response.write('partial');
		markArrived();
	});
	const controller = new AbortController();

	const result = observe(ky(server.url, {signal: controller.signal, timeout: false, retry: {limit: 2, delay: () => 5}}));
	await arrived;
	await delay(100);
	t.false(result.settled);
	controller.abort();
	await delay(50);

	t.true(result.settled);
	t.is(result.error, controller.signal.reason);
	await delay(100);
	t.is(arrivals, 1);
});

test('a POST body is resent byte for byte over real HTTP', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	const bodies: string[] = [];
	server.post('/', async (request, response) => {
		const chunks: Uint8Array[] = [];
		for await (const chunk of request) {
			chunks.push(chunk as Uint8Array);
		}

		bodies.push(Buffer.concat(chunks).toString());
		if (bodies.length === 1) {
			response.sendStatus(503);
			return;
		}

		response.end('ready');
	});

	t.is(await ky.post(server.url, {
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(bytes);
				controller.close();
			},
		}),
		retry: {limit: 1, methods: ['post'], delay: () => 5},
	}).text(), 'ready');
	t.deepEqual(bodies, [payload, payload]);
});
