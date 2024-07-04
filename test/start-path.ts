import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('startPath option', async t => {
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
		// @ts-expect-error {startPath: boolean} isn't officially supported
		await ky(`${server.url}/foo/bar`, {startPath: false}).text(),
		'/foo/bar',
	);
	t.is(await ky(`${server.url}/foo/bar`, {startPath: ''}).text(), '/foo/bar');
	t.is(await ky(new URL(`${server.url}/foo/bar`), {startPath: ''}).text(), '/foo/bar');
	t.is(await ky('foo/bar', {startPath: server.url}).text(), '/foo/bar');
	t.is(await ky('foo/bar', {startPath: new URL(server.url)}).text(), '/foo/bar');
	t.is(await ky('/bar', {startPath: `${server.url}/foo/`}).text(), '/foo/bar');
	t.is(await ky('/bar', {startPath: `${server.url}/foo`}).text(), '/foo/bar');
	t.is(await ky('bar', {startPath: `${server.url}/foo/`}).text(), '/foo/bar');
	t.is(await ky('bar', {startPath: `${server.url}/foo`}).text(), '/foo/bar');
	t.is(await ky('bar', {startPath: new URL(`${server.url}/foo`)}).text(), '/foo/bar');
	t.is(await ky('', {startPath: server.url}).text(), '/');
	t.is(await ky('', {startPath: `${server.url}/`}).text(), '/');
	t.is(await ky('', {startPath: new URL(server.url)}).text(), '/');

	await server.close();
});
