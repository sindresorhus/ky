import util from 'util';
import test from 'ava';
import createTestServer from 'create-test-server';
import body from 'body';
import delay from 'delay';
import ky, {TimeoutError} from '..';

const pBody = util.promisify(body);
const fixture = 'fixture';

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

test('timeout option', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', async (request, response) => {
		requestCount++;
		await delay(1000);
		response.end(fixture);
	});

	await t.throwsAsync(ky(server.url, {timeout: 500}).text(), TimeoutError);
	t.is(requestCount, 1);

	await server.close();
});

test('throwHttpErrors option', async t => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.sendStatus(500);
	});

	await t.notThrowsAsync(
		ky.get(server.url, {throwHttpErrors: false}).text(),
		/Internal Server Error/
	);

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

test('ky.extend() throws when given non-object argument', t => {
	const nonObjectValues = [
		true,
		666,
		'hello',
		[],
		null,
		() => {},
		Symbol('ky')
	];

	for (const value of nonObjectValues) {
		t.throws(() => {
			ky.extend(value);
		}, {
			instanceOf: TypeError,
			message: 'The `defaultOptions` argument must be an object'
		});
	}
});

test('ky.extend() with deep array', async t => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end();
	});

	let isOriginBeforeRequestTrigged = false;
	let isExtendBeforeRequestTrigged = false;

	const extended = ky.extend({
		hooks: {
			beforeRequest: [
				() => {
					isOriginBeforeRequestTrigged = true;
				}
			]
		}
	});

	await extended(server.url, {
		hooks: {
			beforeRequest: [
				() => {
					isExtendBeforeRequestTrigged = true;
				}
			]
		}
	});

	t.is(isOriginBeforeRequestTrigged, true);
	t.is(isExtendBeforeRequestTrigged, true);
	t.true((await extended.head(server.url)).ok);

	await server.close();
});
