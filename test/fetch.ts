import test from 'ava';
import ky from '../source/index.js';

const fixture = 'https://example.com/unicorn';

test('fetch option takes a custom fetch function', async t => {
	t.plan(6);

	const customFetch: typeof fetch = async input => {
		if (!(input instanceof Request)) {
			throw new TypeError('Expected to have input as request');
		}

		return new Response(input.url);
	};

	t.is(await ky(fixture, {fetch: customFetch}).text(), fixture);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: {foo: 'bar'},
		}).text(),
		`${fixture}?foo=bar`,
	);
	t.is(
		await ky(`${fixture}#hash`, {
			fetch: customFetch,
			searchParams: 'foo',
		}).text(),
		`${fixture}?foo#hash`,
	);
	t.is(
		await ky(`${fixture}?old`, {
			fetch: customFetch,
			searchParams: 'new',
		}).text(),
		`${fixture}?new`,
	);
	t.is(
		await ky(`${fixture}?old#hash`, {
			fetch: customFetch,
			searchParams: 'new',
		}).text(),
		`${fixture}?new#hash`,
	);
	t.is(await ky('unicorn', {fetch: customFetch, prefixUrl: `${fixture}/api/`}).text(), `${fixture}/api/unicorn`);
});
