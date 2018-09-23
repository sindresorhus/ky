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
