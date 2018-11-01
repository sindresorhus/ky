import util from 'util';
import test from 'ava';
import createTestServer from 'create-test-server';
import body from 'body';
import delay from 'delay';
import ky from '..';

const pBody = util.promisify(body);

test('hooks can be async', async t => {
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
					async options => {
						await delay(100);
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

test('hooks can be empty object', async t => {
	const expectedResponse = 'empty hook';
	const server = await createTestServer();

	server.get('/', (request, response) => {
		response.end(expectedResponse);
	});

	const response = await ky.get(server.url, {hooks: {}}).text();

	t.is(response, expectedResponse);

	await server.close();
});

test('beforeRequest hook allows modifications', async t => {
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

test('afterResponse hook accept success response', async t => {
	const server = await createTestServer();
	server.post('/', async (request, response) => {
		response.json(JSON.parse(await pBody(request)));
	});

	const json = {
		foo: true
	};

	await t.notThrowsAsync(() => ky.post(
		server.url,
		{
			json,
			hooks: {
				afterResponse: [
					async response => {
						t.is(response.status, 200);
						t.deepEqual(await response.json(), json);
					}
				]
			}
		}
	).json());

	await server.close();
});

test('afterResponse hook accept fail response', async t => {
	const server = await createTestServer();
	server.post('/', async (request, response) => {
		response.status(500).send(JSON.parse(await pBody(request)));
	});

	const json = {
		foo: true
	};

	await t.throwsAsync(() => ky.post(
		server.url,
		{
			json,
			hooks: {
				afterResponse: [
					async response => {
						t.is(response.status, 500);
						t.deepEqual(await response.json(), json);
					}
				]
			}
		}
	).json());

	await server.close();
});

test('afterResponse hook can change response instance by sequence', async t => {
	const server = await createTestServer();
	server.post('/', (request, response) => {
		response.status(500).send();
	});

	const modifiedBody1 = 'hello ky';
	const modifiedStatus1 = 400;
	const modifiedBody2 = 'hello ky again';
	const modifiedStatus2 = 200;

	await t.notThrowsAsync(async () => {
		const responseBody = await ky.post(
			server.url,
			{
				hooks: {
					afterResponse: [
						() => new global.Response(modifiedBody1, {
							status: modifiedStatus1
						}),
						async response => {
							t.is(response.status, modifiedStatus1);
							t.is(await response.text(), modifiedBody1);

							return new global.Response(modifiedBody2, {
								status: modifiedStatus2
							});
						}
					]
				}
			}
		).text();

		t.is(responseBody, modifiedBody2);
	});

	await server.close();
});

test('afterResponse hook can throw error to reject the request promise', async t => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.status(200).send();
	});

	const expectError = new Error('Error from `afterResponse` hook');

	// Sync hook function
	await t.throwsAsync(() => ky.get(
		server.url,
		{
			hooks: {
				afterResponse: [
					() => {
						throw expectError;
					}
				]
			}
		}
	).text(), {
		is: expectError
	});

	// Async hook function
	await t.throwsAsync(() => ky.get(
		server.url,
		{
			hooks: {
				afterResponse: [
					// eslint-disable-next-line require-await
					async () => {
						throw expectError;
					}
				]
			}
		}
	).text(), {
		is: expectError
	});

	await server.close();
});
