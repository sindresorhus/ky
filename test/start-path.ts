import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('startPath option', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.end('zebra');
	});
	server.get('/api/unicorn', (_request, response) => {
		response.end('rainbow');
	});

	t.is(
		// @ts-expect-error {startPath: boolean} isn't officially supported
		await ky(`${server.url}/api/unicorn`, {startPath: false}).text(),
		'rainbow',
	);
	t.is(await ky(`${server.url}/api/unicorn`, {startPath: ''}).text(), 'rainbow');
	t.is(await ky(new URL(`${server.url}/api/unicorn`), {startPath: ''}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {startPath: server.url}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {startPath: new URL(server.url)}).text(), 'rainbow');
	t.is(await ky('unicorn', {startPath: `${server.url}/api`}).text(), 'rainbow');
	t.is(await ky('unicorn', {startPath: `${server.url}/api/`}).text(), 'rainbow');
	t.is(await ky('unicorn', {startPath: new URL(`${server.url}/api`)}).text(), 'rainbow');
	t.is(await ky('', {startPath: server.url}).text(), 'zebra');
	t.is(await ky('', {startPath: `${server.url}/`}).text(), 'zebra');
	t.is(await ky('', {startPath: new URL(server.url)}).text(), 'zebra');

	t.throws(
		() => {
			void ky('/unicorn', {startPath: `${server.url}/api`});
		},
		{
			message: '`input` must not begin with a slash when using `startPath`',
		},
	);

	await server.close();
});
