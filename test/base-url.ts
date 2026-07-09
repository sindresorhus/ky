import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('baseUrl option', async t => {
	const server = await createHttpTestServer();
	const serverHost = new URL(server.url).host;
	server.get('/', (_request, response) => {
		response.end('/');
	});
	server.get('/foo', (_request, response) => {
		response.end('/foo');
	});
	server.get('/bar', (_request, response) => {
		response.end('/bar');
	});
	server.get('/foo/bar', (_request, response) => {
		response.end('/foo/bar');
	});
	server.get('/api/v1/users', (_request, response) => {
		response.end('/api/v1/users');
	});

	t.is(
		// @ts-expect-error {baseUrl: boolean} isn't officially supported
		await ky(`${server.url}/foo/bar`, {baseUrl: false}).text(),
		'/foo/bar',
	);
	t.is(await ky(`${server.url}/foo/bar`, {baseUrl: '/api'}).text(), '/foo/bar');
	t.is(await ky(`${server.url}/foo/bar`, {baseUrl: ''}).text(), '/foo/bar');
	t.is(await ky(new URL(`${server.url}/foo/bar`), {baseUrl: ''}).text(), '/foo/bar');
	t.is(await ky(new URL(`${server.url}/foo/bar`), {baseUrl: `${server.url}/api/`}).text(), '/foo/bar');
	t.is(await ky(new Request(`${server.url}/foo/bar`), {baseUrl: `${server.url}/api/`}).text(), '/foo/bar');
	t.is(await ky('foo/bar', {baseUrl: server.url}).text(), '/foo/bar');
	t.is(await ky(`//${serverHost}/foo/bar`, {baseUrl: `${server.url}/api/`}).text(), '/foo/bar');
	t.is(await ky('/users', {prefix: 'v1', baseUrl: `${server.url}/api/`}).text(), '/api/v1/users');
	t.is(await ky('foo/bar', {baseUrl: new URL(server.url)}).text(), '/foo/bar');
	t.is(await ky('/bar', {baseUrl: `${server.url}/foo/`}).text(), '/bar');
	t.is(await ky('/bar', {baseUrl: `${server.url}/foo`}).text(), '/bar');
	t.is(await ky('bar', {baseUrl: `${server.url}/foo/`}).text(), '/foo/bar');
	t.is(await ky('bar', {baseUrl: `${server.url}/foo`}).text(), '/bar');
	t.is(await ky('bar', {baseUrl: new URL(`${server.url}/foo`)}).text(), '/bar');
	t.is(await ky('', {baseUrl: server.url}).text(), '/');
	t.is(await ky('', {baseUrl: `${server.url}/`}).text(), '/');
	t.is(await ky('', {baseUrl: new URL(server.url)}).text(), '/');

	await server.close();
});

test('baseUrl rejects slashless HTTP URLs', async t => {
	let fetchCallCount = 0;
	const fetch: typeof globalThis.fetch = async () => {
		fetchCallCount++;
		return new Response('attacker');
	};

	const inputs = [
		'http:example.com/collect',
		'https:example.com/collect',
		'HTTP:example.com/collect',
		'HTTPS:example.com/collect',
		' http:example.com/collect',
		' https:example.com/collect',
		'\0http:example.com/collect',
		'\0https:example.com/collect',
		'\thttp:example.com/collect',
		'\thttps:example.com/collect',
		'\nhttp:example.com/collect',
		'\nhttps:example.com/collect',
		'\rhttp:example.com/collect',
		'\rhttps:example.com/collect',
		'h\tttp:example.com/collect',
		'h\tttps:example.com/collect',
		'http:\nexample.com/collect',
		'https:\nexample.com/collect',
		'http:\rexample.com/collect',
		'https:\rexample.com/collect',
		String.raw`http:\example.com/collect`,
		String.raw`https:\example.com/collect`,
		String.raw`http:\\example.com/collect`,
		String.raw`https:\\example.com/collect`,
		String.raw`http:/\example.com/collect`,
		String.raw`https:/\example.com/collect`,
		String.raw`http:\/example.com/collect`,
		String.raw`https:\/example.com/collect`,
	];

	for (const input of inputs) {
		t.throws(
			() => {
				void ky(input, {
					baseUrl: 'https://trusted.test/api/',
					fetch,
					headers: {
						authorization: 'Bearer secret',
					},
				});
			},
			{
				instanceOf: TypeError,
				message: '`input` url protocol must be followed by `//` when using `baseUrl`',
			},
		);
	}

	let absoluteUrl: string | undefined;
	const absoluteFetch: typeof globalThis.fetch = async input => {
		absoluteUrl = new Request(input).url;
		return new Response('ok');
	};

	await t.notThrowsAsync(ky('http://example.test/collect', {
		baseUrl: 'https://trusted.test/api/',
		fetch: absoluteFetch,
	}).text());
	t.is(absoluteUrl, 'http://example.test/collect');

	await t.notThrowsAsync(ky('https://example.test/collect', {
		baseUrl: 'https://trusted.test/api/',
		fetch: absoluteFetch,
	}).text());
	t.is(absoluteUrl, 'https://example.test/collect');

	await Promise.resolve();

	t.is(fetchCallCount, 0);
});

test('baseUrl is exposed on normalized hook options', async t => {
	const server = await createHttpTestServer();
	let receivedBaseUrl: URL | string | undefined;

	server.get('/api/status', (_request, response) => {
		response.end('ok');
	});

	await ky('status', {
		baseUrl: `${server.url}/api/`,
		hooks: {
			beforeRequest: [
				({options}) => {
					receivedBaseUrl = options.baseUrl;
				},
			],
		},
	}).text();

	t.is(receivedBaseUrl, `${server.url}/api/`);

	await server.close();
});
