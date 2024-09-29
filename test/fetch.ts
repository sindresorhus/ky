import test from 'ava';
import ky from '../source/index';

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

test('options are correctly passed to Fetch #1', async t => {
	t.plan(1);

	const cache = 'no-store';

	const customFetch: typeof fetch = async request => {
		t.is(request.cache, cache);
		return new Response(request.url);
	};

	await ky(fixture, {cache, fetch: customFetch}).text();
});

test('options are correctly passed to Fetch #2', async t => {
	const fixture = {x: true};
	const json = await ky.post('https://httpbin.org/anything', {json: fixture}).json();
	t.deepEqual(json.json, fixture);
});

test('unknown options are passed to fetch', async t => {
	t.plan(1);

	const options = {next: {revalidate: 3600}};

	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.next, options.next);
		return new Response(request.url);
	};

	await ky(fixture, {...options, fetch: customFetch}).text();
});
