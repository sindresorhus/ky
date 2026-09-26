import test from 'ava';
import ky, {type ResponsePromise} from '../source/index.js';

const okFetch = async () => new Response('ok');

// `timeout` and `totalTimeout` are documented as milliseconds or `false`. Anything else used to be passed straight to `setTimeout()`, which clamps it to ~1ms, or was silently ignored, so the request never got the timeout the caller asked for. `null` is not accepted either, so it is reported rather than selecting the default.
test('rejects non-numeric and negative `timeout` values', async t => {
	for (const timeout of ['1000', Number.NaN, -1, -0.5, {}, null] as unknown[]) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(ky('https://example.com', {timeout: timeout as never, fetch: okFetch}),
			{
				name: 'TypeError',
				message: 'The `timeout` option must be a non-negative number or `false`',
			},
			`timeout: ${JSON.stringify(timeout)}`,
		);
	}
});

test('rejects non-numeric and negative `totalTimeout` values', async t => {
	for (const totalTimeout of ['1000', Number.NaN, -1, -0.5, {}, null] as unknown[]) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(ky('https://example.com', {totalTimeout: totalTimeout as never, fetch: okFetch}),
			{
				name: 'TypeError',
				message: 'The `totalTimeout` option must be a non-negative number or `false`',
			},
			`totalTimeout: ${JSON.stringify(totalTimeout)}`,
		);
	}
});

test('treats an `undefined` timeout as absent', async t => {
	t.is(await ky('https://example.com', {timeout: undefined, totalTimeout: undefined, fetch: okFetch}).text(), 'ok');
});

test('rejects `timeout` and `totalTimeout` above the maximum safe value', async t => {
	for (const option of ['timeout', 'totalTimeout'] as const) {
		for (const value of [2_147_483_648, Number.POSITIVE_INFINITY]) {
			// eslint-disable-next-line no-await-in-loop
			await t.throwsAsync(ky('https://example.com', {[option]: value, fetch: okFetch}),
				{
					instanceOf: RangeError,
					message: `The \`${option}\` option cannot be greater than 2147483647`,
				},
				`${option}: ${value}`,
			);
		}
	}
});

test('accepts `false`, `0` and non-negative numbers for the timeout options', async t => {
	t.is(await ky('https://example.com', {timeout: false, totalTimeout: false, fetch: okFetch}).text(), 'ok');
	t.is(await ky('https://example.com', {timeout: 0, totalTimeout: 5000, fetch: async () => new Response('a')}).text(), 'a');
});

test('rejects invalid timeout values set from an `init` hook', async t => {
	await t.throwsAsync(ky('https://example.com', {
		fetch: okFetch,
		hooks: {
			init: [options => {
				options.timeout = 'soon' as never;
			}],
		},
	}), {
		name: 'TypeError',
		message: 'The `timeout` option must be a non-negative number or `false`',
	});
});

// These callbacks are called directly, so a non-function value surfaced as a runtime error naming Ky's own internals (`this[#options].stringifyJson`, `initHookOptions.parseJson`) instead of the option the user set, and only once the request had already been built. The constructor calls `stringifyJson` itself, so that one has to be checked before anything else happens.
test('rejects non-function callback options', async t => {
	for (const [key, value] of [
		['parseJson', 'x'],
		['stringifyJson', 5],
		['fetch', 'x'],
		['fetch', null],
		['onDownloadProgress', 'x'],
		['onUploadProgress', 'x'],
	] as Array<[string, unknown]>) {
		const options: Record<string, unknown> = {[key]: value};

		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(ky('https://example.com', options as never), {
			name: 'TypeError',
			message: `The \`${key}\` option must be a function`,
		}, `${key}: ${JSON.stringify(value)}`);
	}
});

test('rejects a non-function `stringifyJson` before it is called', async t => {
	await t.throwsAsync(ky.post('https://example.com', {
		json: {a: 1},
		stringifyJson: 'nope' as never,
		fetch: okFetch,
	}), {
		name: 'TypeError',
		message: 'The `stringifyJson` option must be a function',
	});
});

test('rejects a `throwHttpErrors` value that is neither a boolean nor a function', async t => {
	for (const value of ['yes', 1, {}, null] as unknown[]) {
		const options: Record<string, unknown> = {
			throwHttpErrors: value,
			fetch: async () => new Response('server error', {status: 500}),
		};

		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(ky('https://example.com', options as never), {
			name: 'TypeError',
			message: 'The `throwHttpErrors` option must be a boolean or a function',
		}, `throwHttpErrors: ${JSON.stringify(value)}`);
	}
});

test('accepts a valid `throwHttpErrors` function', async t => {
	const options: Record<string, unknown> = {
		throwHttpErrors: (status: number) => status === 404,
		fetch: async () => new Response('server error', {status: 500}),
	};

	t.is(await ky('https://example.com', options as never).text(), 'server error');
});

// The `input` type check ran after the options were built, so a nullish input dereferenced `.headers` first and reported an internal TypeError instead of the option the caller got wrong.
test('a nullish or non-string `input` reports the input error', async t => {
	for (const input of [null, undefined, 5, {}, true] as unknown[]) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(ky(input as never, {fetch: okFetch}), {
			name: 'TypeError',
			message: '`input` must be a string, URL, or Request',
		}, `input: ${String(input)}`);
	}
});

// `onDownloadProgress` was type-checked at the very end of the pipeline, so an invalid value ran the whole request and only then reported the typo, leaving the response body with nobody able to release it.
test('rejects a non-function `onDownloadProgress` before the request is sent', async t => {
	let fetchCalled = false;
	let beforeRequestCalls = 0;

	await t.throwsAsync(ky('https://example.com', {
		onDownloadProgress: 'x' as never,
		retry: 0,
		hooks: {
			beforeRequest: [() => {
				beforeRequestCalls++;
			}],
		},
		async fetch() {
			fetchCalled = true;
			return new Response('ok');
		},
	}), {
		name: 'TypeError',
		message: 'The `onDownloadProgress` option must be a function',
	});

	t.false(fetchCalled);
	t.is(beforeRequestCalls, 0);
});

// `ky()` returns a promise, so errors while setting up the request reject it, the same way `fetch()` reports them, instead of also throwing synchronously.
test('setup errors reject the returned promise and every body method', async t => {
	const setups: Array<[string, unknown, Record<string, unknown>]> = [
		['invalid option', 'https://example.com', {timeout: -1}],
		['invalid input', 42, {}],
		['invalid merged option', 'https://example.com', {hooks: 'none'}],
		['throwing `init` hook', 'https://example.com', {
			hooks: {
				init: [() => {
					throw new Error('init failed');
				}],
			},
		}],
	];

	for (const [label, input, options] of setups) {
		let responsePromise: ResponsePromise | undefined;
		t.notThrows(() => {
			responsePromise = ky(input as never, {...options, fetch: okFetch});
		}, `${label}`);

		// eslint-disable-next-line no-await-in-loop
		const error = await t.throwsAsync(responsePromise!, undefined, `${label}`);

		for (const method of ['json', 'text', 'arrayBuffer', 'blob', 'formData'] as const) {
			// eslint-disable-next-line no-await-in-loop
			t.is(await t.throwsAsync(responsePromise![method]()), error, `${label}: ${method}`);
		}
	}
});

// Option merging only checked `hooks` when it was an object, and replaced an invalid `retry`, so a later layer hid a `null` or another bad shape instead of reporting it.
test('rejects a bad `hooks` or `retry` while merging, before a later layer can hide it', async t => {
	for (const hooks of [null, 'nope', []] as unknown[]) {
		t.throws(() => ky.create({hooks: hooks as never}), {
			instanceOf: TypeError,
			message: 'The `hooks` option must be an object',
		}, `hooks: ${JSON.stringify(hooks)}`);
	}

	for (const retry of [null, 'nope', []] as unknown[]) {
		t.throws(() => ky.create({retry: retry as never}), {
			instanceOf: TypeError,
			message: '`retry` must be a number or an object',
		}, `retry: ${JSON.stringify(retry)}`);
	}

	await t.throwsAsync(ky.extend({fetch: okFetch})('https://example.com', {hooks: null as never}), {
		name: 'TypeError',
		message: 'The `hooks` option must be an object',
	});
});

test('rejects a `retry.retryOnTimeout` that is not a boolean', async t => {
	for (const retryOnTimeout of [null, 'false', 0] as unknown[]) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(ky('https://example.com', {retry: {retryOnTimeout: retryOnTimeout as never}, fetch: okFetch}), {
			name: 'TypeError',
			message: '`retry.retryOnTimeout` must be a boolean',
		}, `retryOnTimeout: ${JSON.stringify(retryOnTimeout)}`);
	}
});
