import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('baseUrl option', async t => {
	const server = await createHttpTestServer();
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
		// @ts-expect-error {baseUrl: boolean} isn't officially supported
		await ky(`${server.url}/foo/bar`, {baseUrl: false}).text(),
		'/foo/bar',
	);
	t.is(await ky(`${server.url}/foo/bar`, {baseUrl: ''}).text(), '/foo/bar');
	t.is(await ky(new URL(`${server.url}/foo/bar`), {baseUrl: ''}).text(), '/foo/bar');
	t.is(await ky('foo/bar', {baseUrl: server.url}).text(), '/foo/bar');
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
