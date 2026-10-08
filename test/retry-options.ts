import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

// Retries right away, so the tests do not wait for a backoff.
const retryOnce = {limit: 1, delay: () => 0};

// A `fetch` that always answers `503` and counts its calls.
const createUnavailableFetch = () => {
	const state = {
		calls: 0,
		async fetch() {
			state.calls++;
			return new Response('retry', {status: 503});
		},
	};

	return state;
};

test('beforeRetry can turn off upload progress without losing the body', async t => {
	let attempts = 0;
	const progressAttempts: number[] = [];
	const response = await ky.put('https://example.com', {
		body: 'payload',
		retry: retryOnce,
		onUploadProgress() {
			progressAttempts.push(attempts);
		},
		async fetch(request) {
			attempts++;
			t.is(await request.text(), 'payload');
			if (attempts === 1) {
				throw new TypeError('Failed to fetch');
			}

			return new Response('ok');
		},
		hooks: {
			beforeRetry: [() => ({options: {onUploadProgress: undefined}})],
		},
	});

	t.is(await response.text(), 'ok');
	t.is(attempts, 2);
	t.deepEqual(progressAttempts, [1]);
});

test('beforeRetry can turn on upload progress without losing the body', async t => {
	let attempts = 0;
	const progressAttempts: number[] = [];
	const response = await ky.put('https://example.com', {
		body: 'payload',
		retry: retryOnce,
		async fetch(request) {
			attempts++;
			t.is(await request.text(), 'payload');
			if (attempts === 1) {
				throw new TypeError('Failed to fetch');
			}

			return new Response('ok');
		},
		hooks: {
			beforeRetry: [() => ({
				options: {
					onUploadProgress() {
						progressAttempts.push(attempts);
					},
				},
			})],
		},
	});

	t.is(await response.text(), 'ok');
	t.deepEqual(progressAttempts, [2]);
});

test('beforeRetry options apply to later retries and later hooks', async t => {
	let attempts = 0;
	let originalProgressCalls = 0;
	let replacementProgressCalls = 0;
	const originalProgress = () => {
		originalProgressCalls++;
	};

	const replacementProgress = () => {
		replacementProgressCalls++;
	};

	const seenProgress: unknown[] = [];
	const text = await ky('https://example.com', {
		onDownloadProgress: originalProgress,
		retry: {...retryOnce, limit: 2},
		async fetch() {
			attempts++;
			return new Response('ok', {status: attempts < 3 ? 503 : 200});
		},
		hooks: {
			beforeRetry: [
				({options, retryCount}) => {
					seenProgress.push(options.onDownloadProgress);
					if (retryCount === 1) {
						return {options: {onDownloadProgress: replacementProgress}};
					}
				},
				({options}) => {
					t.is(options.onDownloadProgress, replacementProgress);
				},
			],
		},
	}).text();

	t.is(text, 'ok');
	t.is(attempts, 3);
	t.deepEqual(seenProgress, [originalProgress, replacementProgress]);
	t.is(originalProgressCalls, 0);
	t.true(replacementProgressCalls > 0);
});

test('beforeRetry can change fetch and throwHttpErrors', async t => {
	const unavailable = createUnavailableFetch();
	let replacementFetchCalls = 0;
	const response = await ky('https://example.com', {
		retry: retryOnce,
		fetch: unavailable.fetch,
		hooks: {
			beforeRetry: [() => ({
				options: {
					async fetch() {
						replacementFetchCalls++;
						return new Response('still failing', {status: 500});
					},
					throwHttpErrors: false,
				},
			})],
		},
	});

	t.is(response.status, 500);
	t.is(unavailable.calls, 1);
	t.is(replacementFetchCalls, 1);
});

test('beforeRetry can change throwHttpErrors to a function', async t => {
	const unavailable = createUnavailableFetch();
	const statuses: number[] = [];
	const response = await ky('https://example.com', {
		retry: retryOnce,
		fetch: unavailable.fetch,
		hooks: {
			beforeRetry: [() => ({
				options: {
					throwHttpErrors(status) {
						statuses.push(status);
						return false;
					},
				},
			})],
		},
	});

	t.is(response.status, 503);
	t.deepEqual(statuses, [503]);
});

test('beforeRetry can change the timeout', async t => {
	let attempts = 0;
	const response = await ky('https://example.com', {
		timeout: 10,
		retry: {...retryOnce, retryOnTimeout: true},
		async fetch(request) {
			attempts++;
			await new Promise(resolve => {
				setTimeout(resolve, 50);
			});
			request.signal.throwIfAborted();
			return new Response('ok');
		},
		hooks: {
			beforeRetry: [() => ({options: {timeout: 1000}})],
		},
	});

	t.is(await response.text(), 'ok');
	t.is(attempts, 2);
});

test('beforeRetry options apply to a response returned by a later hook', async t => {
	const unavailable = createUnavailableFetch();
	const response = await ky('https://example.com', {
		retry: retryOnce,
		fetch: unavailable.fetch,
		hooks: {
			beforeRetry: [
				() => ({options: {throwHttpErrors: false}}),
				() => new Response('from hook', {status: 500}),
			],
		},
	});

	t.is(response.status, 500);
	t.is(await response.text(), 'from hook');
	t.is(unavailable.calls, 1);
});

test('beforeRetry `undefined` restores the global fetch', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('native');
	});

	const unavailable = createUnavailableFetch();
	const result = await ky(server.url, {
		retry: retryOnce,
		fetch: unavailable.fetch,
		hooks: {beforeRetry: [() => ({options: {fetch: undefined}})]},
	}).text();

	t.is(result, 'native');
	t.is(unavailable.calls, 1);
});

test('beforeRetry `undefined` restores Ky\'s default rather than the instance value', async t => {
	let attempts = 0;
	const api = ky.create({
		throwHttpErrors: false,
		retry: retryOnce,
		async fetch() {
			attempts++;
			if (attempts === 1) {
				throw new TypeError('Failed to fetch');
			}

			return new Response('failed', {status: 500});
		},
	});

	await t.throwsAsync(api('https://example.com', {
		hooks: {beforeRetry: [() => ({options: {throwHttpErrors: undefined}})]},
	}), {name: 'HTTPError'});
	t.is(attempts, 2);
});

test('beforeRetry options do not leak into other requests from the same instance', async t => {
	let progressCalls = 0;
	const attempts = new Map<string, number>();
	const api = ky.create({
		retry: retryOnce,
		onUploadProgress() {
			progressCalls++;
		},
		async fetch(request) {
			const count = (attempts.get(request.url) ?? 0) + 1;
			attempts.set(request.url, count);
			await request.text();
			return new Response('ok', {status: count === 1 ? 503 : 200});
		},
	});

	await api.put('https://example.com/changed', {
		body: 'payload',
		hooks: {beforeRetry: [() => ({options: {onUploadProgress: undefined}})]},
	});
	// A small body reports progress once per streamed attempt.
	t.is(progressCalls, 1);

	await api.put('https://example.com/unchanged', {body: 'payload'});
	t.is(progressCalls, 3);
});

test('beforeRetry options do not reset the retry limit', async t => {
	const unavailable = createUnavailableFetch();
	await t.throwsAsync(ky('https://example.com', {
		retry: {...retryOnce, limit: 2},
		fetch: unavailable.fetch,
		hooks: {beforeRetry: [() => ({options: {timeout: false}})]},
	}), {name: 'HTTPError'});

	t.is(unavailable.calls, 3);
});

const notAnOptionsObject = 'The `options` returned from a `beforeRetry` hook must be an object';

for (const {name, update, message, errorClass = TypeError} of [
	{name: 'a missing `options`', update: {}, message: notAnOptionsObject},
	{name: 'array options', update: {options: []}, message: notAnOptionsObject},
	{name: '`null` options', update: {options: null}, message: notAnOptionsObject},
	{name: 'the `body` option', update: {options: {body: 'payload'}}, message: 'The `body` option cannot be changed from a `beforeRetry` hook'},
	{name: 'the `retry` option', update: {options: {retry: 10}}, message: 'The `retry` option cannot be changed from a `beforeRetry` hook'},
	{
		name: 'a `__proto__` key',
		update: {options: JSON.parse('{"__proto__": {"timeout": 1}}') as unknown},
		message: 'The `__proto__` option cannot be changed from a `beforeRetry` hook',
	},
	{name: 'an invalid callback', update: {options: {onUploadProgress: 'invalid'}}, message: 'The `onUploadProgress` option must be a function'},
	{name: 'a `null` fetch', update: {options: {fetch: null}}, message: 'The `fetch` option must be a function'},
	{name: 'an invalid throwHttpErrors', update: {options: {throwHttpErrors: 'yes'}}, message: 'The `throwHttpErrors` option must be a boolean or a function'},
	{name: 'a `null` throwHttpErrors', update: {options: {throwHttpErrors: null}}, message: 'The `throwHttpErrors` option must be a boolean or a function'},
	{name: 'a `null` timeout', update: {options: {timeout: null}}, message: 'The `timeout` option must be a non-negative number or `false`'},
	{
		name: 'an invalid timeout',
		update: {options: {timeout: 2 ** 31}},
		message: 'The `timeout` option cannot be greater than 2147483647',
		errorClass: RangeError,
	},
]) {
	test(`beforeRetry rejects ${name} before retrying`, async t => {
		const unavailable = createUnavailableFetch();
		await t.throwsAsync(ky('https://example.com', {
			retry: retryOnce,
			fetch: unavailable.fetch,
			hooks: {beforeRetry: [() => update as never]},
		}), {instanceOf: errorClass, message});

		t.is(unavailable.calls, 1);
	});
}
