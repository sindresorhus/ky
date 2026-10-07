import test from 'ava';
import ky from '../source/index.js';

// Each test sends the request to a custom `fetch` that records it, so no server is needed.
const createRecordingFetch = () => {
	const requests: Request[] = [];
	const inits: Array<Record<string, unknown>> = [];

	const fetch = async (request: Request, init: Record<string, unknown>) => {
		requests.push(request);
		inits.push(init);
		return new Response('ok');
	};

	return {fetch: fetch as unknown as typeof globalThis.fetch, requests, inits};
};

// The URL parser removes a tab or newline anywhere in the input, so `h\rttps:` is still the `https:` scheme and must be rejected like `h\tttps:`.
test('baseUrl rejects a slashless HTTP URL with a carriage return inside the scheme', async t => {
	const {fetch, requests} = createRecordingFetch();

	for (const input of ['h\rttps:example.com/collect', 'ht\rtp:example.com/collect']) {
		// eslint-disable-next-line no-await-in-loop
		await t.throwsAsync(ky(input, {baseUrl: 'https://trusted.test/api/', fetch, retry: 0}), {
			instanceOf: TypeError,
			message: '`input` url protocol must be followed by `//` when using `baseUrl`',
		}, `input: ${JSON.stringify(input)}`);
	}

	t.is(requests.length, 0);
});

// The check only guards `baseUrl` resolution. Without a `baseUrl`, the input goes to the `Request` constructor, which parses a slashless special scheme as an absolute URL.
test('a slashless HTTP URL is allowed without baseUrl', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https:example.com/users', {fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/users');
});

// Only leading C0 control or space characters are stripped, like the URL parser does. A space inside the input stays, so `ht tp:` is not a scheme and the input is a relative path.
test('baseUrl resolves an input with a space before the colon as a relative path', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('ht tp:example.com/collect', {baseUrl: 'https://trusted.test/api/', fetch, retry: 0});

	t.is(requests[0]!.url, 'https://trusted.test/api/ht%20tp:example.com/collect');
});

// An absolute input bypasses `baseUrl` completely, so a `baseUrl` that cannot be resolved in Node.js is never used. Each case reaches a different part of the absolute input check.
for (const [description, input, expectedUrl] of [
	['an uppercase scheme', 'HTTPS://example.com/users', 'https://example.com/users'],
	['a scheme with a digit, plus, dot and hyphen', 'web+x-app.v2://example.com/users', 'web+x-app.v2://example.com/users'],
	['leading whitespace', ' https://example.com/users', 'https://example.com/users'],
	['a tab inside the scheme', 'ht\ttps://example.com/users', 'https://example.com/users'],
] as const) {
	test(`an absolute input with ${description} bypasses baseUrl`, async t => {
		const {fetch, requests} = createRecordingFetch();

		await ky(input, {baseUrl: '/api/', fetch, retry: 0});

		t.is(requests[0]!.url, expectedUrl);
	});
}

test('prefix is not applied to a URL input', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky(new URL('https://example.com/users'), {prefix: 'https://other.test/api/', fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/users');
});

test('prefix is not applied to a Request input', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky(new Request('https://example.com/users'), {prefix: 'https://other.test/api/', fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/users');
});

// `prefix` is joined to the input before `baseUrl` resolves it, so a slashless scheme in the prefix gets the same check as one in the input.
test('baseUrl rejects a slashless HTTP URL that comes from prefix', async t => {
	const {fetch, requests} = createRecordingFetch();

	await t.throwsAsync(ky('users', {
		prefix: 'https:evil.test',
		baseUrl: 'https://trusted.test/',
		fetch,
		retry: 0,
	}), {
		instanceOf: TypeError,
		message: '`input` url protocol must be followed by `//` when using `baseUrl`',
	});

	t.is(requests.length, 0);
});

test('an absolute prefix makes the input absolute, so baseUrl is ignored', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('users', {
		prefix: 'https://a.test/v1',
		baseUrl: 'https://b.test/root/',
		fetch,
		retry: 0,
	});

	t.is(requests[0]!.url, 'https://a.test/v1/users');
});

test('a root-relative prefix resolves against the origin of baseUrl', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('users', {
		prefix: '/v1/',
		baseUrl: 'https://example.com/api/',
		fetch,
		retry: 0,
	});

	t.is(requests[0]!.url, 'https://example.com/v1/users');
});

for (const [description, input, expectedUrl] of [
	['a parent path', '../users', 'https://example.com/users'],
	['only a query', '?page=2', 'https://example.com/api/items?page=2'],
	['only a hash', '#top', 'https://example.com/api/items?page=1#top'],
] as const) {
	test(`baseUrl resolves an input with ${description} like the URL parser`, async t => {
		const {fetch, requests} = createRecordingFetch();

		await ky(input, {baseUrl: 'https://example.com/api/items?page=1', fetch, retry: 0});

		t.is(requests[0]!.url, expectedUrl);
	});
}

test('object searchParams add a value to a key that is already in the input URL', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/?tag=a', {searchParams: {tag: 'b'}, fetch, retry: 0});

	t.deepEqual(new URL(requests[0]!.url).searchParams.getAll('tag'), ['a', 'b']);
});

// `URLSearchParams#delete()` serializes the whole query again even when the key is missing, which would turn `%20` into `+` and `?flag` into `?flag=`, and rebuild the request with the changed URL.
for (const input of ['https://example.com/?q=a%20b', 'https://example.com/?flag', 'https://example.com/?a=1;b=2']) {
	test(`object searchParams with only an undefined value for a missing key leave ${input} unchanged`, async t => {
		const {fetch, requests} = createRecordingFetch();

		await ky(input, {searchParams: {missing: undefined}, fetch, retry: 0});

		t.is(requests[0]!.url, input);
	});
}

test('object searchParams with an undefined value for a missing key keep the body of a Request input with a non-canonical query', async t => {
	const input = new Request('https://example.com/?q=a%20b', {method: 'POST', body: 'payload'});

	await ky(input, {
		searchParams: {missing: undefined},
		keepalive: true,
		retry: 0,
		async fetch(request) {
			t.is((request as Request).url, 'https://example.com/?q=a%20b');
			t.is(await (request as Request).text(), 'payload');
			return new Response('ok');
		},
	});
});

test('object searchParams with an undefined value still remove that key from the input URL', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/?a=1&b=2', {searchParams: {a: undefined}, fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?b=2');
});

test('string searchParams only strip a leading question mark', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/', {searchParams: 'q=why?', fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?q=why?');
});

// An `undefined` value removes its key from the input URL, and every other value is appended after the input query in the order of the object.
test('object searchParams that mix removals and additions keep the order of the input URL and the object', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/?a=1&b=2&c=3', {searchParams: {b: undefined, d: '4', a: '5'}, fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?a=1&c=3&d=4&a=5');
});

test('an undefined value in object searchParams removes every value of that key', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/?a=1&b=2&a=3', {searchParams: {a: undefined}, fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?b=2');
});

test('object searchParams send falsy and non-string values as strings', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/', {
		searchParams: {
			zero: 0,
			no: false,
			yes: true,
			fraction: 1.5,
		},
		fetch,
		retry: 0,
	});

	t.is(requests[0]!.url, 'https://example.com/?zero=0&no=false&yes=true&fraction=1.5');
});

test('object searchParams encode reserved characters, so a value cannot add another parameter', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/', {searchParams: {q: 'a b&c=d', 'k y': 'v'}, fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?q=a+b%26c%3Dd&k+y=v');
});

test('searchParams pairs and URLSearchParams keep every value of a repeated key after the input query', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/?x=1', {searchParams: [['a', '1'], ['a', '2'], ['b', '3']], fetch, retry: 0});
	await ky('https://example.com/?a=0', {searchParams: new URLSearchParams([['a', '1'], ['a', '2']]), fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?x=1&a=1&a=2&b=3');
	t.is(requests[1]!.url, 'https://example.com/?a=0&a=1&a=2');
});

test('string searchParams with a leading question mark are joined to the input query with an ampersand', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/?a=1', {searchParams: '?b=2&c', fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?a=1&b=2&c');
});

test('string searchParams are appended without encoding the input query or themselves again', async t => {
	const {fetch, requests} = createRecordingFetch();

	await ky('https://example.com/?q=a%20b', {searchParams: 'r=c+d&s=e%20f', fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?q=a%20b&r=c+d&s=e%20f');
});

for (const [input, expectedUrl] of [
	['https://example.com/path#hash', 'https://example.com/path?a=1#hash'],
	['https://example.com/path?x=1#hash', 'https://example.com/path?x=1&a=1#hash'],
] as const) {
	test(`string searchParams go before the hash of ${input}`, async t => {
		const {fetch, requests} = createRecordingFetch();

		await ky(input, {searchParams: 'a=1', fetch, retry: 0});

		t.is(requests[0]!.url, expectedUrl);
	});
}

for (const [description, searchParameters] of [
	['an empty string', ''],
	['a lone question mark', '?'],
	['an empty object', {}],
	['an empty URLSearchParams', new URLSearchParams()],
	['an empty array', []],
] as const) {
	test(`searchParams with ${description} leave a non-canonical input URL unchanged`, async t => {
		const {fetch, requests} = createRecordingFetch();

		await ky('https://example.com/?q=a%20b', {searchParams: searchParameters, fetch, retry: 0});

		t.is(requests[0]!.url, 'https://example.com/?q=a%20b');
	});
}

// `.extend()` stores an `undefined` key as a deletion marker on the merged `URLSearchParams`, which must only touch an input URL that has the key, like an `undefined` value in the request options.
test('a deletion marker from .extend() only rewrites an input URL that has the key', async t => {
	const {fetch, requests} = createRecordingFetch();
	const api = ky.create({searchParams: {a: '1'}}).extend({searchParams: {a: undefined}});

	await api('https://example.com/?q=a%20b', {fetch, retry: 0});
	await api('https://example.com/?a=0&b=2', {fetch, retry: 0});

	t.is(requests[0]!.url, 'https://example.com/?q=a%20b');
	t.is(requests[1]!.url, 'https://example.com/?b=2');
});

// The `Request` input's `content-type` comes from its own body, so it must not describe a replacement `URLSearchParams` body.
test('a URLSearchParams body replaces the content-type of a Request input', async t => {
	const {fetch, requests} = createRecordingFetch();
	const input = new Request('https://example.com/', {method: 'POST', body: 'plain'});

	await ky(input, {body: new URLSearchParams({a: '1'}), fetch, retry: 0});

	t.is(requests[0]!.headers.get('content-type'), 'application/x-www-form-urlencoded;charset=UTF-8');
});

test('a content-type from the headers option is kept for a FormData body on a Request input', async t => {
	const {fetch, requests} = createRecordingFetch();
	const input = new Request('https://example.com/', {method: 'POST', body: 'plain'});
	const body = new FormData();
	body.append('field', 'value');

	await ky(input, {
		body,
		headers: {'content-type': 'multipart/form-data; boundary=custom'},
		fetch,
		retry: 0,
	});

	t.is(requests[0]!.headers.get('content-type'), 'multipart/form-data; boundary=custom');
});

// The `Request` constructor only normalizes the methods the Fetch standard lists, so a lowercase `query` on a `Request` input is still lowercase when Ky reads it.
test('a standard method from a Request input is uppercased', async t => {
	const {fetch, requests} = createRecordingFetch();
	const input = new Request('https://example.com/', {method: 'query'});
	t.is(input.method, 'query');

	await ky(input, {fetch, retry: 0});

	t.is(requests[0]!.method, 'QUERY');
});

// Option merging rejects an array `context`, but an `init` hook assigns straight onto the options object.
test('an init hook that sets context to an array gets an error naming the option', async t => {
	const {fetch, requests} = createRecordingFetch();

	await t.throwsAsync(ky('https://example.com', {
		fetch,
		hooks: {
			init: [options => {
				options.context = [] as never;
			}],
		},
	}), {
		instanceOf: TypeError,
		message: 'The `context` option must be an object',
	});

	t.is(requests.length, 0);
});

// Standard request options are already applied to the `Request`, so repeating them in the init object would let `fetch()` apply them a second time.
test('fetch does not receive standard request options in its init object', async t => {
	const {fetch, requests, inits} = createRecordingFetch();

	await ky.post('https://example.com', {
		body: 'body',
		headers: {'x-custom': 'value'},
		mode: 'cors',
		credentials: 'include',
		cache: 'no-store',
		redirect: 'manual',
		referrer: 'about:client',
		referrerPolicy: 'no-referrer',
		integrity: 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
		keepalive: false,
		signal: new AbortController().signal,
		window: undefined,
		priority: 'low',
		fetch,
		retry: 0,
	});

	t.is(requests[0]!.integrity, 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
	t.deepEqual(Object.keys(inits[0]!), ['priority']);
});

test('fetch does not receive Ky options in its init object', async t => {
	const {fetch, inits} = createRecordingFetch();

	await ky.post('users', {
		json: {a: 1},
		parseJson: JSON.parse,
		stringifyJson: JSON.stringify,
		searchParams: {page: 1},
		baseUrl: 'https://example.com/',
		prefix: 'api',
		retry: 0,
		timeout: 1000,
		totalTimeout: 2000,
		maxResponseSize: 1000,
		hooks: {},
		throwHttpErrors: true,
		onDownloadProgress: () => undefined,
		onUploadProgress: () => undefined,
		context: {token: 'secret'},
		dispatcher: 'agent',
		fetch,
	} as never);

	t.deepEqual(Object.keys(inits[0]!), ['dispatcher']);
});
