import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('prefix option', async t => {
	const server = await createHttpTestServer(t);
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

	t.is(
		// @ts-expect-error {prefix: boolean} isn't officially supported
		await ky(`${server.url}/foo/bar`, {prefix: false}).text(),
		'/foo/bar',
	);
	t.is(await ky(`${server.url}/foo/bar`, {prefix: ''}).text(), '/foo/bar');
	t.is(await ky(new URL(`${server.url}/foo/bar`), {prefix: ''}).text(), '/foo/bar');
	t.is(await ky('foo/bar', {prefix: server.url}).text(), '/foo/bar');
	t.is(await ky('foo/bar', {prefix: new URL(server.url)}).text(), '/foo/bar');
	t.is(await ky('/bar', {prefix: `${server.url}/foo/`}).text(), '/foo/bar');
	t.is(await ky('/bar', {prefix: `${server.url}/foo`}).text(), '/foo/bar');
	t.is(await ky('bar', {prefix: `${server.url}/foo/`}).text(), '/foo/bar');
	t.is(await ky('bar', {prefix: `${server.url}/foo`}).text(), '/foo/bar');
	t.is(await ky('bar', {prefix: new URL(`${server.url}/foo`)}).text(), '/foo/bar');
	t.is(await ky('', {prefix: server.url}).text(), '/');
	t.is(await ky('', {prefix: `${server.url}/`}).text(), '/');
	t.is(await ky('', {prefix: new URL(server.url)}).text(), '/');

	t.throws(
		() => {
			void ky('/unicorn', {prefixUrl: `${server.url}/api`});
		},
		{
			message: 'The `prefixUrl` option has been renamed `prefix` in v2 and enhanced to allow slashes in input. See also the new `baseUrl` option for improved flexibility with standard URL resolution: https://github.com/sindresorhus/ky#baseurl',
		},
	);
});
