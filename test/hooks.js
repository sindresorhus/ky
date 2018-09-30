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
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end('empty hook');
	});

	const rsp = await ky.get(server.url, {hooks: {}}).text();

	t.is(rsp, 'empty hook');

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

	await ky.post(
		server.url,
		{
			json,
			hooks: {
				afterResponse: [
					async rsp => {
						t.is(rsp.status, 200);
						t.deepEqual(await rsp.json(), json);
					}
				]
			}
		}
	).json();

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
					async rsp => {
						t.is(rsp.status, 500);
						t.deepEqual(await rsp.json(), json);
					}
				]
			}
		}
	).json());

	await server.close();
});
