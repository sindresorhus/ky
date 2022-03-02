import {Buffer} from 'node:buffer';
import test from 'ava';
import delay from 'delay';
import ky, {TimeoutError} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';
import {parseRawBody} from './helpers/parse-body.js';

const fixture = 'fixture';

test('ky()', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.end();
	});

	const {ok} = await ky(server.url);
	t.true(ok);

	await server.close();
});

test('GET request', async t => {
	const server = await createHttpTestServer();
	server.get('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky(server.url).text(), 'GET');

	await server.close();
});

test('POST request', async t => {
	const server = await createHttpTestServer();
	server.post('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.post(server.url).text(), 'POST');

	await server.close();
});

test('PUT request', async t => {
	const server = await createHttpTestServer();
	server.put('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.put(server.url).text(), 'PUT');

	await server.close();
});

test('PATCH request', async t => {
	const server = await createHttpTestServer();
	server.patch('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.patch(server.url).text(), 'PATCH');

	await server.close();
});

test('HEAD request', async t => {
	t.plan(2);

	const server = await createHttpTestServer();
	server.head('/', (request, response) => {
		response.end(request.method);
		t.pass();
	});

	t.is(await ky.head(server.url).text(), '');

	await server.close();
});

test('DELETE request', async t => {
	const server = await createHttpTestServer();
	server.delete('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.delete(server.url).text(), 'DELETE');

	await server.close();
});

test('POST JSON', async t => {
	t.plan(2);

	const server = await createHttpTestServer();
	server.post('/', async (request, response) => {
		t.is(request.headers['content-type'], 'application/json');
		response.json(request.body);
	});

	const json = {
		foo: true,
	};

	const responseJson = await ky.post(server.url, {json}).json();

	t.deepEqual(responseJson, json);

	await server.close();
});

test('cannot use `body` option with GET or HEAD method', t => {
	t.throws(
		() => {
			void ky.get('https://example.com', {body: 'foobar'});
		},
		{
			message: 'Request with GET/HEAD method cannot have body',
		},
	);

	t.throws(
		() => {
			void ky.head('https://example.com', {body: 'foobar'});
		},
		{
			message: 'Request with GET/HEAD method cannot have body',
		},
	);
});

test('cannot use `json` option with GET or HEAD method', t => {
	t.throws(
		() => {
			void ky.get('https://example.com', {json: {}});
		},
		{
			message: 'Request with GET/HEAD method cannot have body',
		},
	);

	t.throws(
		() => {
			void ky.head('https://example.com', {json: {}});
		},
		{
			message: 'Request with GET/HEAD method cannot have body',
		},
	);
});

test('`json` option overrides the `body` option', async t => {
	t.plan(2);

	const server = await createHttpTestServer();
	server.post('/', async (request, response) => {
		t.is(request.headers['content-type'], 'application/json');
		response.json(request.body);
	});

	const json = {
		foo: 'bar',
	};

	const responseJson = await ky
		.post(server.url, {
			body: 'hello',
			json,
		})
		.json();

	t.deepEqual(responseJson, json);

	await server.close();
});

test('custom headers', async t => {
	const server = await createHttpTestServer();
	server.get('/', (request, response) => {
		response.end(request.headers['unicorn']);
	});

	t.is(
		await ky(server.url, {
			headers: {
				unicorn: fixture,
			},
		}).text(),
		fixture,
	);

	await server.close();
});

test('JSON with custom Headers instance', async t => {
	t.plan(3);

	const server = await createHttpTestServer();
	server.post('/', async (request, response) => {
		t.is(request.headers['unicorn'], 'rainbow');
		t.is(request.headers['content-type'], 'application/json');
		response.json(request.body);
	});

	const json = {
		foo: true,
	};

	const responseJson = await ky
		.post(server.url, {
			headers: new Headers({unicorn: 'rainbow'}),
			json,
		})
		.json();

	t.deepEqual(responseJson, json);

	await server.close();
});

test('.json() with custom accept header', async t => {
	t.plan(2);

	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		t.is(request.headers.accept, 'foo/bar');
		response.json({});
	});

	const responseJson = await ky(server.url, {
		headers: {accept: 'foo/bar'},
	}).json();

	t.deepEqual(responseJson, {});

	await server.close();
});

test('.json() with 200 response and empty body', async t => {
	t.plan(2);

	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		t.is(request.headers.accept, 'application/json');
		response.status(200).end();
	});

	await t.throwsAsync(ky(server.url).json(), {
		message: /Unexpected end of JSON input/,
	});

	await server.close();
});

test('.json() with 204 response and empty body', async t => {
	t.plan(2);

	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		t.is(request.headers.accept, 'application/json');
		response.status(204).end();
	});

	const responseJson = await ky(server.url).json();

	t.is(responseJson, '');

	await server.close();
});

test('timeout option', async t => {
	t.plan(2);
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		await delay(2000);
		response.end(fixture);
	});

	await t.throwsAsync(ky(server.url, {timeout: 1000}).text(), {
		instanceOf: TimeoutError,
	});

	t.is(requestCount, 1);

	await server.close();
});

test('timeout:false option', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		await delay(1000);
		response.end(fixture);
	});

	await t.notThrowsAsync(ky(server.url, {timeout: false}).text());

	t.is(requestCount, 1);

	await server.close();
});

test('invalid timeout option', async t => {
	// #117
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		await delay(1000);
		response.end(fixture);
	});

	await t.throwsAsync(ky(server.url, {timeout: 21_474_836_470}).text(), {
		instanceOf: RangeError,
		message: 'The `timeout` option cannot be greater than 2147483647',
	});

	t.is(requestCount, 0);

	await server.close();
});

test('timeout option is cancelled when the promise is resolved', async t => {
	const server = await createHttpTestServer();

	server.get('/', (request, response) => {
		response.end(request.method);
	});

	const start = Date.now();

	await ky(server.url, {timeout: 2000});

	const duration = start - Date.now();

	t.true(duration < 10);

	await server.close();
});

test('searchParams option', async t => {
	const server = await createHttpTestServer();

	server.get('/', (request, response) => {
		response.end(request.url.slice(1));
	});

	const arrayParameters = [
		['cats', 'meow'],
		['dogs', 'true'],
		['opossums', 'false'],
	];
	const objectParameters = {
		cats: 'meow',
		dogs: 'true',
		opossums: 'false',
	};
	const searchParameters = new URLSearchParams(arrayParameters);
	const stringParameters = '?cats=meow&dogs=true&opossums=false';
	const customStringParameters = '?cats&dogs[0]=true&dogs[1]=false';

	t.is(await ky(server.url, {searchParams: arrayParameters}).text(), stringParameters);
	t.is(await ky(server.url, {searchParams: objectParameters}).text(), stringParameters);
	t.is(await ky(server.url, {searchParams: searchParameters}).text(), stringParameters);
	t.is(await ky(server.url, {searchParams: stringParameters}).text(), stringParameters);
	t.is(await ky(server.url, {searchParams: customStringParameters}).text(), customStringParameters);

	await server.close();
});

test('throwHttpErrors option', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.sendStatus(500);
	});

	await t.notThrowsAsync(ky.get(server.url, {throwHttpErrors: false}).text());

	await server.close();
});

test('throwHttpErrors option with POST', async t => {
	const server = await createHttpTestServer();
	server.post('/', (_request, response) => {
		response.sendStatus(500);
	});

	await t.notThrowsAsync(ky.post(server.url, {throwHttpErrors: false}).text());

	await server.close();
});

test('throwHttpErrors:false does not suppress timeout errors', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		await delay(1000);
		response.sendStatus(500);
	});

	await t.throwsAsync(
		ky(server.url, {throwHttpErrors: false, timeout: 500}).text(),
		{instanceOf: TimeoutError},
	);

	t.is(requestCount, 1);

	await server.close();
});

test('ky.create()', async t => {
	const server = await createHttpTestServer();
	server.get('/', (request, response) => {
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		response.end(`${request.headers['unicorn']} - ${request.headers['rainbow']}`);
	});

	const extended = ky.create({
		headers: {
			rainbow: 'rainbow',
		},
	});

	t.is(
		await extended(server.url, {
			headers: {
				unicorn: 'unicorn',
			},
		}).text(),
		'unicorn - rainbow',
	);

	const {ok} = await extended.head(server.url);
	t.true(ok);

	await server.close();
});

test('ky.create() throws when given non-object argument', t => {
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	const nonObjectValues = [true, 666, 'hello', [], null, () => {}, Symbol('ky')];

	for (const value of nonObjectValues) {
		t.throws(
			() => {
				// @ts-expect-error
				ky.create(value);
			},
			{
				instanceOf: TypeError,
				message: 'The `options` argument must be an object',
			},
		);
	}
});

test('ky.create() with deep array', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.end();
	});

	let isOriginBeforeRequestTrigged = false;
	let isExtendBeforeRequestTrigged = false;

	const extended = ky.create({
		hooks: {
			beforeRequest: [
				() => {
					isOriginBeforeRequestTrigged = true;
				},
			],
		},
	});

	await extended(server.url, {
		hooks: {
			beforeRequest: [
				() => {
					isExtendBeforeRequestTrigged = true;
				},
			],
		},
	});

	t.is(isOriginBeforeRequestTrigged, true);
	t.is(isExtendBeforeRequestTrigged, true);

	const {ok} = await extended.head(server.url);
	t.true(ok);

	await server.close();
});

test('ky.create() does not mangle search params', async t => {
	const server = await createHttpTestServer();
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const instance = ky.create({searchParams: {}});
	t.is(await instance.get(server.url, {searchParams: {}}).text(), '/?');

	await server.close();
});

test('ky.extend()', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.end();
	});

	let isOriginBeforeRequestTrigged = false;
	let isExtendBeforeRequestTrigged = false;

	const extended = ky
		.extend({
			hooks: {
				beforeRequest: [
					() => {
						isOriginBeforeRequestTrigged = true;
					},
				],
			},
		})
		.extend({
			hooks: {
				beforeRequest: [
					() => {
						isExtendBeforeRequestTrigged = true;
					},
				],
			},
		});

	await extended(server.url);

	t.is(isOriginBeforeRequestTrigged, true);
	t.is(isExtendBeforeRequestTrigged, true);

	const {ok} = await extended.head(server.url);
	t.true(ok);

	await server.close();
});

test('throws AbortError when aborted by user', async t => {
	const server = await createHttpTestServer();
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	server.get('/', () => {});

	const abortController = new AbortController();
	const {signal} = abortController;
	const response = ky(server.url, {signal});
	abortController.abort();

	await t.throwsAsync(response, {name: 'AbortError'});
});

test('supports Request instance as input', async t => {
	const server = await createHttpTestServer();
	const inputRequest = new Request(server.url, {method: 'POST'});

	server.post('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky(inputRequest).text(), inputRequest.method);

	await server.close();
});

test('throws when input is not a string, URL, or Request', t => {
	t.throws(
		() => {
			// @ts-expect-error
			void ky.get(0);
		},
		{
			message: '`input` must be a string, URL, or Request',
		},
	);
});

test('options override Request instance method', async t => {
	const server = await createHttpTestServer();
	const inputRequest = new Request(server.url, {method: 'GET'});

	server.post('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky(inputRequest, {method: 'POST'}).text(), 'POST');

	await server.close();
});

test('options override Request instance body', async t => {
	const server = await createHttpTestServer({bodyParser: false});

	const requestBody = JSON.stringify({test: true});
	const expectedBody = JSON.stringify({test: false});

	const inputRequest = new Request(server.url, {
		method: 'POST',
		body: requestBody,
	});

	server.post('/', (request, response) => {
		const body: Buffer[] = [];

		request.on('data', (chunk: Buffer) => {
			body.push(chunk);
		});

		request.on('end', () => {
			const bodyAsString = Buffer.concat(body).toString();

			t.is(bodyAsString, expectedBody);
			response.end();
		});
	});

	await ky(inputRequest, {body: expectedBody});

	await server.close();
});

test('POST JSON with falsey value', async t => {
	// #222
	const server = await createHttpTestServer({bodyParser: false});
	server.post('/', async (request, response) => {
		response.json(await parseRawBody(request));
	});

	const json = false;
	const responseJson = await ky.post(server.url, {json}).json();

	t.deepEqual(responseJson, json.toString());

	await server.close();
});

test('parseJson option with response.json()', async t => {
	const json = {hello: 'world'};

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		response.json(json);
	});

	const response = await ky.get(server.url, {
		parseJson: text => ({
			...JSON.parse(text),
			extra: 'extraValue',
		}),
	});
	const responseJson = await response.json();

	t.deepEqual(responseJson, {
		...json,
		extra: 'extraValue',
	});

	await server.close();
});

test('parseJson option with promise.json() shortcut', async t => {
	const json = {hello: 'world'};

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		response.json(json);
	});

	const responseJson = await ky
		.get(server.url, {
			parseJson: text => ({
				...JSON.parse(text),
				extra: 'extraValue',
			}),
		})
		.json();

	t.deepEqual(responseJson, {
		...json,
		extra: 'extraValue',
	});

	await server.close();
});
