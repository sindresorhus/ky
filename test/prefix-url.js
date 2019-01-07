import test from 'ava';
import createTestServer from 'create-test-server';
import ky from '..';

const createServer = async () => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		if (request.query.page === '/cat') {
			response.end('meow');
			return;
		}
		response.end('zebra');
	});

	server.get('/api/unicorn', (request, response) => {
		response.end('rainbow');
	});

	return server;
};

test.beforeEach(async t => {
	const server = await createServer();

	global.document = {
		baseURI: server.url
	};

	t.context.server = server;
});

test.afterEach(() => {
	delete global.document;
});

test('prefixUrl can be an falsy', async t => {
	t.is(await ky(`${t.context.server.url}/api/unicorn`, {prefixUrl: ''}).text(), 'rainbow');
	t.is(await ky(`${t.context.server.url}/api/unicorn`, {prefixUrl: false}).text(), 'rainbow');
});

test('prefixUrl can be an absolute URL with no trailing slash, when `input` has no leading `/`', async t => {
	t.is(await ky('unicorn', {prefixUrl: `${t.context.server.url}/api`}).text(), 'rainbow');
});

test('prefixUrl can be an absolute URL with a trailing slash, when `input` has a leading `/`', async t => {
	t.is(await ky('unicorn', {prefixUrl: `${t.context.server.url}/api/`}).text(), 'rainbow');
});

test('prefixUrl can be the full request URL', async t => {
	t.is(await ky('', {prefixUrl: t.context.server.url}).text(), 'zebra');
	t.is(await ky('', {prefixUrl: `${t.context.server.url}/`}).text(), 'zebra');
});

test('prefixUrl can be a URL object', async t => {
	t.is(await ky('cat', {prefixUrl: new URL(`${t.context.server.url}/?page=`)}).text(), 'meow');
});

test('when `input` is an absolute URL, it takes precedence over prefixUrl', async t => {
	t.is(await ky(`${t.context.server.url}/api/unicorn`, {prefixUrl: `${t.context.server.url}/api`}).text(), 'rainbow');
});

test('when prefixUrl is a string, input can be a URL object', async t => {
	t.is(await ky(new URL(`${t.context.server.url}/api/unicorn`), {prefixUrl: `${t.context.server.url}/api`}).text(), 'rainbow');
});

test('prefixUrl and input can both be a URL object', async t => {
	t.is(await ky(new URL(`${t.context.server.url}/api/unicorn`), {prefixUrl: new URL(`${t.context.server.url}`)}).text(), 'rainbow');
});

test('when prefixUrl is specified, `input` cannot have a leading `/`', t => {
	global.document = {
		baseURI: t.context.server.url
	};

	t.throws(() => {
		ky('/unicorn', {prefixUrl: '/api'}).text();
	}, '`input` must not begin with a slash when using `prefixUrl`');
});

test('prefixUrl cannot be relative when `input` is relative and run in non-browser environments', t => {
	delete global.document;

	t.throws(() => {
		ky('unicorn', {prefixUrl: '/api'}).text();
	}, 'The `prefixUrl` option must be set to a full URL, incl. protocol, when using a relative `input` URL inside a non-browser environment');
});
