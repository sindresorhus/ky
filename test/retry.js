import test from 'ava';
import createTestServer from 'create-test-server';
import ky from '..';

const fixture = 'fixture';
const defaultRetryCount = 2;
const retryAfterOn413 = 2;
const lastTried413access = Date.now();

test('retry - network error', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end(fixture);
		} else {
			response.status(99999).end();
		}
	});

	t.is(await ky(server.url).text(), fixture);

	await server.close();
});

test('retry - status code 500', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	t.is(await ky(server.url).text(), fixture);

	await server.close();
});

test('retry - only on defined status codes', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end(fixture);
		} else {
			response.sendStatus(400);
		}
	});

	await t.throwsAsync(ky(server.url).text(), /Bad Request/);

	await server.close();
});

test('retry - not on POST', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.post('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await t.throwsAsync(ky.post(server.url).text(), /Internal Server Error/);

	await server.close();
});

test('retry - delay by Retry-After header', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end((Date.now() - lastTried413access).toString());
		} else {
			response.writeHead(413, {
				'Retry-After': retryAfterOn413
			});
			response.end('');
		}
	});

	const result = await ky(server.url).text();
	t.true(Number(result) >= retryAfterOn413 * 1000);

	await server.close();
});

test('retry - delay by Retry-After header with timestamp', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;
		if (requestCount === defaultRetryCount) {
			response.end((Date.now() - lastTried413access).toString());
		} else {
			const date = (new Date(Date.now() + (retryAfterOn413 * 1000))).toUTCString();
			response.writeHead(413, {
				'Retry-After': date
			});
			response.end('');
		}
	});

	const result = await ky(server.url).text();
	t.true(Number(result) >= retryAfterOn413 * 1000);

	await server.close();
});
