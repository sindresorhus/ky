import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('prefixUrl option', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.end('zebra');
	});
	server.get('/api/unicorn', (_request, response) => {
		response.end('rainbow');
	});

	t.is(
		// @ts-expect-error {prefixUrl: boolean} isn't officially supported
		await ky(`${server.url}/api/unicorn`, {prefixUrl: false}).text(),
		'rainbow',
	);
	t.is(await ky(`${server.url}/api/unicorn`, {prefixUrl: ''}).text(), 'rainbow');
	t.is(await ky(new URL(`${server.url}/api/unicorn`), {prefixUrl: ''}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {prefixUrl: server.url}).text(), 'rainbow');
	t.is(await ky('api/unicorn', {prefixUrl: new URL(server.url)}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: `${server.url}/api`}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: `${server.url}/api/`}).text(), 'rainbow');
	t.is(await ky('unicorn', {prefixUrl: new URL(`${server.url}/api`)}).text(), 'rainbow');
	t.is(await ky('', {prefixUrl: server.url}).text(), 'zebra');
	t.is(await ky('', {prefixUrl: `${server.url}/`}).text(), 'zebra');
	t.is(await ky('', {prefixUrl: new URL(server.url)}).text(), 'zebra');

	t.throws(
		() => {
			void ky('/unicorn', {prefixUrl: `${server.url}/api`});
		},
		{
			message: '`input` must not begin with a slash when using `prefixUrl`',
		},
	);

	await server.close();
});
