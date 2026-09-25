import test from 'ava';
import ky from '../source/index.js';

const okFetch = async () => new Response('ok');

// `timeout` and `totalTimeout` are documented as milliseconds or `false`. Anything else used to be passed
// straight to `setTimeout()`, which clamps it to ~1ms, or was silently ignored, so the request never got the
// timeout the caller asked for. `null` is left out: it is nullish, so it selects the default.
test('rejects non-numeric and negative `timeout` values', async t => {
	for (const timeout of ['1000', Number.NaN, -1, -0.5, {}] as unknown[]) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(
			ky('https://example.com', {timeout: timeout as never, fetch: okFetch}).text(),
			{
				name: 'TypeError',
				message: 'The `timeout` option must be a non-negative number or `false`',
			},
			`timeout: ${JSON.stringify(timeout)}`,
		);
	}
});

test('rejects non-numeric and negative `totalTimeout` values', async t => {
	for (const totalTimeout of ['1000', Number.NaN, -1, -0.5, {}] as unknown[]) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(
			ky('https://example.com', {totalTimeout: totalTimeout as never, fetch: okFetch}).text(),
			{
				name: 'TypeError',
				message: 'The `totalTimeout` option must be a non-negative number or `false`',
			},
			`totalTimeout: ${JSON.stringify(totalTimeout)}`,
		);
	}
});

test('treats a nullish timeout as absent', async t => {
	t.is(await ky('https://example.com', {timeout: null as never, totalTimeout: null as never, fetch: okFetch}).text(), 'ok');
});

test('rejects `timeout` and `totalTimeout` above the maximum safe value', async t => {
	for (const option of ['timeout', 'totalTimeout'] as const) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(
			ky('https://example.com', {[option]: 2_147_483_648, fetch: okFetch}).text(),
			{
				instanceOf: RangeError,
				message: `The \`${option}\` option cannot be greater than 2147483647`,
			},
			`option: ${option}`,
		);
	}
});

test('accepts `false`, `0` and non-negative numbers for the timeout options', async t => {
	t.is(await ky('https://example.com', {timeout: false, totalTimeout: false, fetch: okFetch}).text(), 'ok');
	t.is(await ky('https://example.com', {timeout: 0, totalTimeout: 5000, fetch: async () => new Response('a')}).text(), 'a');
});

test('rejects invalid timeout values set from an `init` hook', async t => {
	await t.throwsAsync(
		ky('https://example.com', {
			fetch: okFetch,
			hooks: {
				init: [options => {
					options.timeout = 'soon' as never;
				}],
			},
		}).text(),
		{
			name: 'TypeError',
			message: 'The `timeout` option must be a non-negative number or `false`',
		},
	);
});
