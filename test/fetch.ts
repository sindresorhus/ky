import test from 'ava';
import ky from '../source/index.js';

test.serial('relative URLs are passed to fetch unresolved', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async input => {
		if (typeof input !== 'object') {
			throw new TypeError('Expect to have an object request');
		}

		t.true(input.url.startsWith('/'));
		return new Response(input.url);
	};

	t.is(await ky('/unicorn').text(), '/unicorn');
	t.is(await ky('/unicorn', {searchParams: {foo: 'bar'}}).text(), '/unicorn?foo=bar');
	t.is(await ky('/unicorn#hash', {searchParams: 'foo'}).text(), '/unicorn?foo#hash');
	t.is(await ky('/unicorn?old', {searchParams: 'new'}).text(), '/unicorn?new');
	t.is(await ky('/unicorn?old#hash', {searchParams: 'new'}).text(), '/unicorn?new#hash');
	t.is(await ky('unicorn', {prefixUrl: '/api/'}).text(), '/api/unicorn');
	globalThis.fetch = originalFetch;
});

test('fetch option takes a custom fetch function', async t => {
	t.plan(6);

	const customFetch: typeof fetch = async input => {
		if (!(input instanceof Request)) {
			throw new TypeError('Expected to have input as request');
		}

		return new Response(input.url);
	};

	t.is(await ky('/unicorn', {fetch: customFetch}).text(), '/unicorn');
	t.is(
		await ky('/unicorn', {
			fetch: customFetch,
			searchParams: {foo: 'bar'},
		}).text(),
		'/unicorn?foo=bar',
	);
	t.is(
		await ky('/unicorn#hash', {
			fetch: customFetch,
			searchParams: 'foo',
		}).text(),
		'/unicorn?foo#hash',
	);
	t.is(
		await ky('/unicorn?old', {
			fetch: customFetch,
			searchParams: 'new',
		}).text(),
		'/unicorn?new',
	);
	t.is(
		await ky('/unicorn?old#hash', {
			fetch: customFetch,
			searchParams: 'new',
		}).text(),
		'/unicorn?new#hash',
	);
	t.is(await ky('unicorn', {fetch: customFetch, prefixUrl: '/api/'}).text(), '/api/unicorn');
});
