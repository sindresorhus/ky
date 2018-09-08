import util from 'util';
import test from 'ava';
import createTestServer from 'create-test-server';
import fetch from 'node-fetch';
import body from 'body';
import delay from 'delay';
import ky from '.';

const pBody = util.promisify(body);

const fixture = 'fixture';
const defaultRetryCount = 2;

global.window = {};
global.window.fetch = fetch;
global.window.Headers = fetch.Headers;

test('ky()', async t => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end();
	});

	t.true((await ky(server.url)).ok);

	await server.close();
});

test('GET request', async t => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky(server.url).text(), 'GET');

	await server.close();
});

test('POST request', async t => {
	const server = await createTestServer();
	server.post('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.post(server.url).text(), 'POST');

	await server.close();
});

test('PUT request', async t => {
	const server = await createTestServer();
	server.put('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.put(server.url).text(), 'PUT');

	await server.close();
});

test('PATCH request', async t => {
	const server = await createTestServer();
	server.patch('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.patch(server.url).text(), 'PATCH');

	await server.close();
});

test('HEAD request', async t => {
	t.plan(2);

	const server = await createTestServer();
	server.head('/', (request, response) => {
		response.end(request.method);
		t.pass();
	});

	t.is(await ky.head(server.url).text(), '');

	await server.close();
});

test('DELETE request', async t => {
	const server = await createTestServer();
	server.delete('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.delete(server.url).text(), 'DELETE');

	await server.close();
});

test('POST JSON', async t => {
	t.plan(2);

	const server = await createTestServer();
	server.post('/', async (request, response) => {
		t.is(request.headers['content-type'], 'application/json');
		response.json(JSON.parse(await pBody(request)));
	});

	const json = {
		foo: true
	};

	const responseJson = await ky.post(server.url, {json}).json();

	t.deepEqual(json, responseJson);

	await server.close();
});

test('custom headers', async t => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end(request.headers.unicorn);
	});

	t.is(await ky(server.url, {
		headers: {
			unicorn: fixture
		}
	}).text(), fixture);

	await server.close();
});

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

test('timeout option', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', async (request, response) => {
		requestCount++;
		await delay(1000);
		response.end(fixture);
	});

	await t.throwsAsync(ky(server.url, {timeout: 500}).text(), ky.TimeoutError);
	t.is(requestCount, 1);

	await server.close();
});

test('beforeRequest allows modifications', async t => {
	const server = await createTestServer();
	server.post('/', async (request, response) => {
		response.json(JSON.parse(await pBody(request)));
	});

	const json = {
		foo: true
	};

	const responseJson = await ky.post(
		server.url,
		{
			json,
			hooks: {
				beforeRequest: [
					options => {
						const bodyJson = JSON.parse(options.body);
						bodyJson.foo = false;
						options.body = JSON.stringify(bodyJson);
					}
				]
			}
		}
	).json();

	t.false(responseJson.foo);

	await server.close();
});

test('ky.extend()', async t => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end(`${request.headers.unicorn} - ${request.headers.rainbow}`);
	});

	const extended = ky.extend({
		headers: {
			rainbow: 'rainbow'
		}
	});

	t.is(
		await extended(server.url, {
			headers: {
				unicorn: 'unicorn'
			}
		}).text(),
		'unicorn - rainbow'
	);

	t.true((await extended.head(server.url)).ok);

	await server.close();
});
