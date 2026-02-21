import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const fixture = 'https://example.com/unicorn';

test('fetch option takes a custom fetch function', async t => {
	t.plan(10);

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
		await ky(fixture, {
			fetch: customFetch,
			searchParams: {},
		}).text(),
		`${fixture}`,
	);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: [],
		}).text(),
		`${fixture}`,
	);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: new URLSearchParams(),
		}).text(),
		`${fixture}`,
	);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: '  ',
		}).text(),
		`${fixture}`,
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
	const server = await createHttpTestServer(t);

	server.post('/anything', (request, response) => {
		response.json({json: request.body});
	});

	const fixture = {x: true};
	const json = await ky.post(`${server.url}/anything`, {json: fixture}).json();
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

test('fetch-only options like dispatcher are passed to fetch', async t => {
	t.plan(1);

	const mockDispatcher = {name: 'custom-agent'};

	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.dispatcher, mockDispatcher);
		return new Response(request.url);
	};

	await ky(fixture, {dispatcher: mockDispatcher, fetch: customFetch}).text();
});

test('priority option is passed to fetch', async t => {
	t.plan(1);

	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.priority, 'high');
		return new Response(request.url);
	};

	await ky(fixture, {priority: 'high', fetch: customFetch}).text();
});

test.serial('vendor-specific options like `next` are passed to fetch even when Request is patched', async t => {
	t.plan(1);

	const options = {next: {revalidate: 3600, tags: ['test']}};

	// Simulate Next.js edge runtime behavior by patching Request.prototype
	const originalDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'next');

	try {
		// Patch Request.prototype to have a 'next' property (like Next.js does in edge runtime)
		Object.defineProperty(Request.prototype, 'next', {
			value: undefined,
			writable: true,
			enumerable: true,
			configurable: true,
		});

		const customFetch: typeof fetch = async (request, init) => {
			// Verify that the `next` option is still passed to fetch despite being on Request.prototype
			t.deepEqual(init.next, options.next);
			return new Response(request.url);
		};

		await ky(fixture, {...options, fetch: customFetch}).text();
	} finally {
		// Restore original state
		if (originalDescriptor) {
			Object.defineProperty(Request.prototype, 'next', originalDescriptor);
		} else {
			delete (Request.prototype as any).next;
		}
	}
});
