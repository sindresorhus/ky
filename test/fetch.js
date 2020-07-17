import test from 'ava';
import ky from '..';

test.serial('relative URLs are passed to fetch unresolved', async t => {
	const originalFetch = global.fetch;
	global.fetch = async input => {
		t.true(input.url.startsWith('/'));
		return new Response(input.url);
	};

	t.is(await ky('/unicorn').text(), '/unicorn');
	t.is(await ky('/unicorn', {searchParams: {foo: 'bar'}}).text(), '/unicorn?foo=bar');
	t.is(await ky('/unicorn#hash', {searchParams: 'foo'}).text(), '/unicorn?foo=#hash');
	t.is(await ky('/unicorn?old', {searchParams: 'new'}).text(), '/unicorn?new=');
	t.is(await ky('/unicorn?old#hash', {searchParams: 'new'}).text(), '/unicorn?new=#hash');
	t.is(await ky('unicorn', {prefixUrl: '/api/'}).text(), '/api/unicorn');
	global.fetch = originalFetch;
});
