import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('prefix option', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('zebra');
	});
	server.get('/api/unicorn', (_request, response) => {
		response.end('rainbow');
	});

	t.is(
		// @ts-expect-error {prefix: boolean} isn't officially supported
		await ky(`${server.url}/api/unicorn`, {prefix: false}).text(),
		'rainbow',
	);
	t.is(await ky(`${server.url}/api/unicorn`, {prefix: ''}).text(), 'rainbow');
	t.is(await ky(new URL(`${server.url}/api/unicorn`), {prefix: ''}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {prefix: server.url}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {prefix: new URL(server.url)}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefix: `${server.url}/api`}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefix: `${server.url}/api/`}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefix: new URL(`${server.url}/api`)}).text(), 'rainbow');
	t.is(await ky('', {prefix: server.url}).text(), 'zebra');
	t.is(await ky('', {prefix: `${server.url}/`}).text(), 'zebra');
	t.is(await ky('', {prefix: new URL(server.url)}).text(), 'zebra');

	t.throws(
		() => {
			void ky('/unicorn', {prefix: `${server.url}/api`});
		},
		{
			message: '`input` must not begin with a slash when using `prefix`',
		},
	);
});
