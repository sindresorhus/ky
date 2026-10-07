import test from 'ava';
import ky, {replaceOption, type Hooks} from '../source/index.js';
import {validateAndMerge} from '../source/utils/merge.js';

const echoUrl = async (request: Request) => new Response(request.url);
const echoBody = async (request: Request) => new Response(await request.text());
const echoHeaders = async (request: Request) => new Response(JSON.stringify(Object.fromEntries(request.headers)));

// `cloneDeep`

test('an `init` hook mutating an object inside a `json` array does not leak into the next request', async t => {
	const bodies: string[] = [];
	const api = ky.create({
		json: {items: [{count: 1}]},
		async fetch(request) {
			bodies.push(await request.text());
			return new Response('ok');
		},
		hooks: {
			init: [
				options => {
					(options.json as {items: Array<{count: number}>}).items[0]!.count++;
				},
			],
		},
	});

	await api.post('https://example.com');
	await api.post('https://example.com');

	t.deepEqual(bodies, ['{"items":[{"count":2}]}', '{"items":[{"count":2}]}']);
});

test('an own `__proto__` key in `json` survives the `init` hook copy', async t => {
	const json: unknown = JSON.parse('{"__proto__":{"a":1},"b":2}');

	const body = await ky.post('https://example.com', {
		json,
		fetch: echoBody,
		hooks: {
			init: [() => undefined],
		},
	}).text();

	t.is(body, '{"__proto__":{"a":1},"b":2}');
});

test('a nested non-enumerable `json` property is not sent, even when an `init` hook copies the body', async t => {
	const nested: Record<string, unknown> = {visible: 1};
	Object.defineProperty(nested, 'hidden', {value: 2, enumerable: false});

	for (const init of [[], [() => undefined]]) {
		// eslint-disable-next-line no-await-in-loop
		const body = await ky.post('https://example.com', {
			json: {nested},
			fetch: echoBody,
			hooks: {init},
		}).text();

		t.is(body, '{"nested":{"visible":1}}');
	}
});

test('the `init` hook copy of `json` keeps nested symbol-keyed values', async t => {
	const symbol = Symbol('meta');
	let seen: unknown;

	await ky.post('https://example.com', {
		json: {nested: {[symbol]: 'meta', value: 1}},
		fetch: async () => new Response('ok'),
		hooks: {
			init: [
				options => {
					seen = (options.json as {nested: Record<symbol, unknown>}).nested[symbol];
				},
			],
		},
	});

	t.is(seen, 'meta');
});

// Headers

test('the string "undefined" in header pairs is sent as a value instead of removing the header', async t => {
	const api = ky.create({headers: {'x-a': '1', 'x-b': '1'}, fetch: echoHeaders});

	const headers = await api('https://example.com', {
		headers: [['x-a', 'undefined']],
	}).json<Record<string, string>>();

	t.is(headers['x-a'], 'undefined');
	t.is(headers['x-b'], '1');
});

test('the string "undefined" in a plain object header is sent as a value instead of removing the header', async t => {
	const api = ky.create({headers: {'x-a': '1'}, fetch: echoHeaders});

	const headers = await api('https://example.com', {
		headers: {'x-a': 'undefined'},
	}).json<Record<string, string>>();

	t.is(headers['x-a'], 'undefined');
});

test('an `init` hook sees a header removed with `undefined` as a lowercase key with an `undefined` value', async t => {
	let initHeaders: Record<string, string | undefined> | undefined;
	const api = ky.create({headers: {'X-Removed': '1', 'X-Kept': '1'}}).extend({headers: {'X-REMOVED': undefined}});

	const headers = await api('https://example.com', {
		fetch: echoHeaders,
		hooks: {
			init: [
				options => {
					initHeaders = {...options.headers as Record<string, string | undefined>};
				},
			],
		},
	}).json<Record<string, string>>();

	t.true(Object.hasOwn(initHeaders!, 'x-removed'));
	t.deepEqual(initHeaders, {'x-removed': undefined, 'x-kept': '1'});
	t.false('x-removed' in headers);
});

test('repeated header pairs replace an inherited value and keep every repeated value', async t => {
	const api = ky.create({headers: {'x-a': '0'}, fetch: echoHeaders});

	const headers = await api('https://example.com', {
		headers: [['x-a', '1'], ['x-a', '2']],
	}).json<Record<string, string>>();

	t.is(headers['x-a'], '1, 2');
});

test('a plain object header replaces every value of a repeated header in a `Headers` default', async t => {
	const api = ky.create({headers: new Headers([['x-a', '1'], ['x-a', '2']]), fetch: echoHeaders});

	const replaced = await api('https://example.com', {headers: {'x-a': '3'}}).json<Record<string, string>>();
	const kept = await api('https://example.com', {headers: {'x-b': '3'}}).json<Record<string, string>>();

	t.is(replaced['x-a'], '3');
	t.is(kept['x-a'], '1, 2');
});

test('merging does not rewrite nested user data with a `headers` key', async t => {
	const api = ky.create({json: {headers: {'X-Name': 'a'}}, fetch: echoBody}).extend({json: {headers: {'x-other': 'b'}}});

	t.is(await api.post('https://example.com').text(), '{"headers":{"X-Name":"a","x-other":"b"}}');
});

// Search parameters

test('a merged `URLSearchParams` layer removes the keys it deleted from the layers merged before it', t => {
	const merged = validateAndMerge({searchParams: {a: '0'}}, {searchParams: {a: undefined, b: '2'}}).searchParams as URLSearchParams;
	const result = validateAndMerge({searchParams: {a: '1', c: '3'}}, {searchParams: merged}).searchParams as URLSearchParams;

	t.is(result.toString(), 'c=3&b=2');
});

test('extending a string `searchParams` default with an `undefined` key removes the key from the default and the input URL', async t => {
	const api = ky.create({searchParams: 'a=1&b=2', fetch: echoUrl}).extend({searchParams: {a: undefined}});

	t.is(await api('https://example.com/?a=0&z=9').text(), 'https://example.com/?z=9&b=2');
});

test('`searchParams: undefined` clears inherited search parameters', async t => {
	const api = ky.create({searchParams: {a: '1'}, fetch: echoUrl});
	const extended = api.extend({searchParams: undefined});

	t.is(await extended('https://example.com/?keep=1').text(), 'https://example.com/?keep=1');
	t.is(await api('https://example.com', {searchParams: undefined}).text(), 'https://example.com/');
	t.is(await extended('https://example.com', {searchParams: {b: '2'}}).text(), 'https://example.com/?b=2');
});

test('`searchParams: null` over inherited search parameters gets an error naming the option', async t => {
	const api = ky.create({searchParams: {a: '1'}, fetch: echoUrl});
	const expectation = {instanceOf: TypeError, message: 'The `searchParams` option must not be `null`. Use `undefined` to clear it.'};

	t.throws(() => api.extend({searchParams: null as never}), expectation);
	await t.throwsAsync(api('https://example.com', {searchParams: null as never}).text(), expectation);
});

test('merging search parameter pairs over defaults rejects an entry that is not a pair', async t => {
	const api = ky.create({searchParams: {a: '1'}, fetch: echoUrl});

	// A pair that is not an array, and an array that is not a pair.
	for (const searchParameters of [['a=1'], [['a', '1', '2']]]) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(api('https://example.com', {searchParams: searchParameters as never}).text(), {
			instanceOf: TypeError,
			message: 'Array search parameters must be provided in [[key, value], ...] format',
		}, `searchParams: ${JSON.stringify(searchParameters)}`);
	}
});

// `replaceOption`

test('resolving a nested `replaceOption` does not change the caller\'s options object', t => {
	const marker = replaceOption({ttl: 60});
	const cloudflare = {cacheTtlByStatus: marker};
	const options: Record<string, unknown> = {cf: cloudflare};

	const merged = validateAndMerge({cf: {cacheTtlByStatus: {old: 1}}}, options) as Record<string, unknown>;
	const unmerged = validateAndMerge(options) as Record<string, unknown>;

	t.deepEqual(merged.cf, {cacheTtlByStatus: {ttl: 60}});
	t.deepEqual(unmerged.cf, {cacheTtlByStatus: {ttl: 60}});
	t.is(cloudflare.cacheTtlByStatus, marker);
	t.not(unmerged.cf, cloudflare);
});

test('resolving `replaceOption` inside an array copies only that array and leaves the caller\'s marker in place', t => {
	const marker = replaceOption(2);
	const list = [1, marker, 3];
	const unmarked = [4];

	const merged = validateAndMerge({list, unmarked}) as Record<string, unknown>;

	t.deepEqual(merged.list, [1, 2, 3]);
	t.not(merged.list, list);
	t.is(list[1], marker);
	t.is(merged.unmarked, unmarked);
});

test('`replaceOption` wrappers nested in `context` are not walked, so large context values are left alone', async t => {
	const large = new Proxy({}, {
		ownKeys() {
			throw new Error('The context value was walked');
		},
	});

	t.is(await ky('https://example.com', {
		context: {large},
		fetch: async () => new Response('ok'),
	}).text(), 'ok');
});

// Hooks

test('`replaceOption(undefined)` on a single hook type clears only that hook type', async t => {
	const calls: string[] = [];
	const api = ky.create({
		fetch: async () => new Response('ok'),
		hooks: {
			beforeRequest: [
				() => {
					calls.push('beforeRequest');
				},
			],
			afterResponse: [
				() => {
					calls.push('afterResponse');
				},
			],
		},
	}).extend({hooks: {beforeRequest: replaceOption(undefined as Hooks['beforeRequest'])}});

	await api('https://example.com');

	t.deepEqual(calls, ['afterResponse']);
});

test('`beforeRetry` hooks from the instance, an extension and the request run in that order', async t => {
	const calls: string[] = [];
	const hook = (name: string) => () => {
		calls.push(name);
	};

	let attempts = 0;
	const api = ky.create({
		retry: {limit: 1, delay: () => 0},
		async fetch() {
			attempts++;
			return new Response('', {status: attempts === 1 ? 500 : 200});
		},
		hooks: {beforeRetry: [hook('instance')]},
	}).extend({hooks: {beforeRetry: [hook('extension')]}});

	await api('https://example.com', {hooks: {beforeRetry: [hook('request')]}});

	t.deepEqual(calls, ['instance', 'extension', 'request']);
});

// `context`

test('merging `context` copies only enumerable properties', async t => {
	const context: Record<string, unknown> = {visible: 1};
	Object.defineProperty(context, 'hidden', {value: 2, enumerable: false});
	let seen: Record<string, unknown> | undefined;

	await ky.create({context: {base: 0}})('https://example.com', {
		context,
		fetch: async () => new Response('ok'),
		hooks: {
			beforeRequest: [
				({options}) => {
					seen = options.context;
				},
			],
		},
	});

	t.deepEqual(seen, {base: 0, visible: 1});
	t.false('hidden' in seen!);
});

// `create` and `extend`

test('mutating an inherited `URLSearchParams` inside an `extend` callback does not change the parent instance', async t => {
	const parent = ky.create({searchParams: new URLSearchParams('a=1'), fetch: echoUrl});

	parent.extend(options => {
		(options.searchParams as URLSearchParams).append('child', '1');
		return {};
	});

	t.is(await parent('https://example.com').text(), 'https://example.com/?a=1');
});

test('the function form of `.extend()` on the root `ky` receives an empty object', t => {
	let received: unknown;
	ky.extend(options => {
		received = options;
		return {};
	});

	t.deepEqual(received, {});
});

test('the function form of `.extend()` is called once when extending, not for every request', async t => {
	let calls = 0;
	const api = ky.create({fetch: async () => new Response('ok')}).extend(() => {
		calls++;
		return {};
	});

	t.is(calls, 1);
	await api('https://example.com');
	await api('https://example.com');
	t.is(calls, 1);
});

test('`.create()` on an instance does not inherit that instance\'s defaults', async t => {
	const parent = ky.create({headers: {'x-parent': '1'}, searchParams: {parent: '1'}});
	const created = parent.create({fetch: echoHeaders});

	const headers = await created('https://example.com').json<Record<string, string>>();
	t.false('x-parent' in headers);
	t.is(await created('https://example.com', {fetch: echoUrl}).text(), 'https://example.com/');
});

test('a method shortcut wins over a `method` in the request options and the defaults', async t => {
	const api = ky.create({method: 'put', fetch: async request => new Response(request.method)});

	t.is(await api.post('https://example.com', {method: 'patch'}).text(), 'POST');
	t.is(await api.delete('https://example.com').text(), 'DELETE');
	t.is(await api('https://example.com', {method: 'patch'}).text(), 'PATCH');
	t.is(await api('https://example.com').text(), 'PUT');
});

test('the function form of `.extend()` appends hooks after the parent hooks', async t => {
	const calls: string[] = [];
	const parent = ky.create({
		fetch: async () => new Response('ok'),
		hooks: {
			beforeRequest: [
				() => {
					calls.push('parent');
				},
			],
		},
	});

	const child = parent.extend(() => ({
		hooks: {
			beforeRequest: [
				() => {
					calls.push('child');
				},
			],
		},
	}));

	await child('https://example.com');
	await parent('https://example.com');

	t.deepEqual(calls, ['parent', 'child', 'parent']);
});
