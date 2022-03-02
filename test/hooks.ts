import test from 'ava';
import delay from 'delay';
import ky, {HTTPError} from '../source/index.js';
import {Options} from '../source/types/options.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('hooks can be async', async t => {
	const server = await createHttpTestServer();
	server.post('/', async (request, response) => {
		response.json(request.body);
	});

	const json = {
		foo: true,
	};

	const responseJson = await ky
		.post(server.url, {
			json,
			hooks: {
				beforeRequest: [
					async (request, options) => {
						await delay(100);
						const bodyJson = JSON.parse(options.body as string);
						bodyJson.foo = false;
						return new Request(request, {body: JSON.stringify(bodyJson)});
					},
				],
			},
		})
		.json<typeof json>();

	t.false(responseJson.foo);

	await server.close();
});

test('hooks can be empty object', async t => {
	const expectedResponse = 'empty hook';
	const server = await createHttpTestServer();

	server.get('/', (_request, response) => {
		response.end(expectedResponse);
	});

	const response = await ky.get(server.url, {hooks: {}}).text();

	t.is(response, expectedResponse);

	await server.close();
});

test('beforeRequest hook allows modifications', async t => {
	const server = await createHttpTestServer();
	server.post('/', async (request, response) => {
		response.json(request.body);
	});

	const json = {
		foo: true,
	};

	const responseJson = await ky
		.post(server.url, {
			json,
			hooks: {
				beforeRequest: [
					(request, options) => {
						const bodyJson = JSON.parse(options.body as string);
						bodyJson.foo = false;
						return new Request(request, {body: JSON.stringify(bodyJson)});
					},
				],
			},
		})
		.json<typeof json>();

	t.false(responseJson.foo);

	await server.close();
});

test('afterResponse hook accept success response', async t => {
	const server = await createHttpTestServer();
	server.post('/', async (request, response) => {
		response.json(request.body);
	});

	const json = {
		foo: true,
	};

	await t.notThrowsAsync(
		ky
			.post(server.url, {
				json,
				hooks: {
					afterResponse: [
						async (_input, _options, response) => {
							t.is(response.status, 200);
							t.deepEqual(await response.json(), json);
						},
					],
				},
			})
			.json(),
	);

	await server.close();
});

test('afterResponse hook accept fail response', async t => {
	const server = await createHttpTestServer();
	server.post('/', async (request, response) => {
		response.status(500).send(request.body);
	});

	const json = {
		foo: true,
	};

	await t.throwsAsync(
		ky
			.post(server.url, {
				json,
				hooks: {
					afterResponse: [
						async (_input, _options, response) => {
							t.is(response.status, 500);
							t.deepEqual(await response.json(), json);
						},
					],
				},
			})
			.json(),
	);

	await server.close();
});

test('afterResponse hook can change response instance by sequence', async t => {
	const server = await createHttpTestServer();
	server.post('/', (_request, response) => {
		response.status(500).send();
	});

	const modifiedBody1 = 'hello ky';
	const modifiedStatus1 = 400;
	const modifiedBody2 = 'hello ky again';
	const modifiedStatus2 = 200;

	await t.notThrowsAsync(async () => {
		const responseBody = await ky
			.post(server.url, {
				hooks: {
					afterResponse: [
						() =>
							new Response(modifiedBody1, {
								status: modifiedStatus1,
							}),
						async (_input, _options, response) => {
							t.is(response.status, modifiedStatus1);
							t.is(await response.text(), modifiedBody1);

							return new Response(modifiedBody2, {
								status: modifiedStatus2,
							});
						},
					],
				},
			})
			.text();

		t.is(responseBody, modifiedBody2);
	});

	await server.close();
});

test('afterResponse hook can throw error to reject the request promise', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.status(200).send();
	});

	const expectError = new Error('Error from `afterResponse` hook');

	// Sync hook function
	await t.throwsAsync(
		ky
			.get(server.url, {
				hooks: {
					afterResponse: [
						() => {
							throw expectError;
						},
					],
				},
			})
			.text(),
		{
			is: expectError,
		},
	);

	// Async hook function
	await t.throwsAsync(
		ky
			.get(server.url, {
				hooks: {
					afterResponse: [
						async () => {
							throw expectError;
						},
					],
				},
			})
			.text(),
		{
			is: expectError,
		},
	);

	await server.close();
});

test('`afterResponse` hook gets called even if using body shortcuts', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.json({});
	});

	let called = false;
	await ky
		.get(server.url, {
			hooks: {
				afterResponse: [
					(_input, _options, response) => {
						called = true;
						return response;
					},
				],
			},
		})
		.json();

	t.true(called);

	await server.close();
});

test('`afterResponse` hook is called with request, normalized options, and response which can be used to retry', async t => {
	const server = await createHttpTestServer();
	server.post('/', async (request, response) => {
		const json = request.body;
		if (json.token === 'valid:token') {
			response.json(json);
		} else {
			response.sendStatus(403);
		}
	});

	const json = {
		foo: true,
		token: 'invalid:token',
	};

	t.deepEqual(
		await ky
			.post(server.url, {
				json,
				hooks: {
					afterResponse: [
						async (request, options, response) => {
							if (response.status === 403) {
								// Retry request with valid token
								return ky(request, {
									...options,
									json: {
										...(options as Options).json as Record<string, unknown>,
										token: 'valid:token',
									},
								});
							}

							return undefined;
						},
					],
				},
			})
			.json(),
		{
			foo: true,
			token: 'valid:token',
		},
	);

	await server.close();
});

test('afterResponse hook with parseJson and response.json()', async t => {
	t.plan(5);

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		response.end('text');
	});

	const json = await ky
		.get(server.url, {
			parseJson(text) {
				t.is(text, 'text');
				return {awesome: true};
			},
			hooks: {
				afterResponse: [
					async (_request, _options, response) => {
						t.true(response instanceof Response);
						t.deepEqual(await response.json(), {awesome: true});
					},
				],
			},
		})
		.json();

	t.deepEqual(json, {awesome: true});

	await server.close();
});

test('beforeRetry hook is never called for the initial request', async t => {
	const fixture = 'fixture';
	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		response.end(request.headers['unicorn']);
	});

	t.not(
		await ky
			.get(server.url, {
				hooks: {
					beforeRetry: [
						({options}) => {
							(options.headers as Headers | undefined)?.set('unicorn', fixture);
						},
					],
				},
			})
			.text(),
		fixture,
	);

	await server.close();
});

test('beforeRetry hook allows modifications of non initial requests', async t => {
	let requestCount = 0;

	const fixture = 'fixture';
	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 1) {
			response.end(request.headers['unicorn']);
		} else {
			response.sendStatus(408);
		}
	});

	t.is(
		await ky
			.get(server.url, {
				hooks: {
					beforeRetry: [
						({request}) => {
							request.headers.set('unicorn', fixture);
						},
					],
				},
			})
			.text(),
		fixture,
	);

	await server.close();
});

test('beforeRetry hook is called with error and retryCount', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 1) {
			response.end(request.headers['unicorn']);
		} else {
			response.sendStatus(408);
		}
	});

	await ky.get(server.url, {
		hooks: {
			beforeRetry: [
				({error, retryCount}) => {
					t.true(error instanceof HTTPError);
					t.true(retryCount >= 1);
				},
			],
		},
	});

	await server.close();
});

test('beforeRetry hook is called even if the error has no response', async t => {
	t.plan(6);

	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		response.end('unicorn');
	});

	const text = await ky
		.get(server.url, {
			retry: 2,
			async fetch(request) {
				if (requestCount === 0) {
					requestCount++;
					throw new Error('simulated network failure');
				}

				return globalThis.fetch(request);
			},
			hooks: {
				beforeRetry: [
					({error, retryCount}) => {
						t.is(error.message, 'simulated network failure');
						// @ts-expect-error
						t.is(error.response, undefined);
						t.is(retryCount, 1);
						t.is(requestCount, 1);
					},
				],
			},
		})
		.text();

	t.is(text, 'unicorn');
	t.is(requestCount, 2);

	await server.close();
});

test('beforeRetry hook with parseJson and error.response.json()', async t => {
	t.plan(10);

	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.status(502).end('text');
		} else {
			response.end('text');
		}
	});

	const json = await ky
		.get(server.url, {
			retry: 2,
			parseJson(text) {
				t.is(text, 'text');
				return {awesome: true};
			},
			hooks: {
				beforeRetry: [
					async ({error, retryCount}) => {
						t.true(error instanceof HTTPError);
						t.is(error.message, 'Request failed with status code 502 Bad Gateway');
						t.true((error as HTTPError).response instanceof Response);
						t.deepEqual(await (error as HTTPError).response.json(), {awesome: true});
						t.is(retryCount, 1);
						t.is(requestCount, 1);
					},
				],
			},
		})
		.json();

	t.deepEqual(json, {awesome: true});
	t.is(requestCount, 2);

	await server.close();
});

test('beforeRetry hook can cancel retries by returning `stop`', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 2) {
			response.end(request.headers['unicorn']);
		} else {
			response.sendStatus(408);
		}
	});

	await ky.get(server.url, {
		hooks: {
			beforeRetry: [
				({error, retryCount}) => {
					t.truthy(error);
					t.is(retryCount, 1);

					return ky.stop;
				},
			],
		},
	});

	t.is(requestCount, 1);

	await server.close();
});

test('catches beforeRetry thrown errors', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 1) {
			response.end(request.headers['unicorn']);
		} else {
			response.sendStatus(408);
		}
	});

	const errorString = 'oops';
	const error = new Error(errorString);

	await t.throwsAsync(
		ky.get(server.url, {
			hooks: {
				beforeRetry: [
					() => {
						throw error;
					},
				],
			},
		}),
		{message: errorString},
	);
});

test('catches beforeRetry promise rejections', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 1) {
			response.end(request.headers['unicorn']);
		} else {
			response.sendStatus(408);
		}
	});

	const errorString = 'oops';
	const error = new Error(errorString);

	await t.throwsAsync(
		ky.get(server.url, {
			hooks: {
				beforeRetry: [
					async () => {
						throw error;
					},
				],
			},
		}),
		{message: errorString},
	);
});

test('hooks beforeRequest returning Response skips HTTP Request', async t => {
	const expectedResponse = 'empty hook';

	const response = await ky
		.get('server.url', {
			hooks: {
				beforeRequest: [() => new Response(expectedResponse, {status: 200, statusText: 'OK'})],
			},
		})
		.text();

	t.is(response, expectedResponse);
});

test('runs beforeError before throwing HTTPError', async t => {
	const server = await createHttpTestServer();
	server.post('/', (_request, response) => {
		response.status(500).send();
	});

	await t.throwsAsync(
		ky.post(server.url, {
			hooks: {
				beforeError: [
					(error: HTTPError) => {
						const {response} = error;

						if (response?.body) {
							error.name = 'GitHubError';
							error.message = `${response.statusText} --- (${response.status})`.trim();
						}

						return error;
					},
				],
			},
		}),
		{
			name: 'GitHubError',
			message: 'Internal Server Error --- (500)',
		},
	);

	await server.close();
});

test('beforeError can return promise which resolves to HTTPError', async t => {
	const server = await createHttpTestServer();
	const responseBody = {reason: 'github down'};
	server.post('/', (_request, response) => {
		response.status(500).send(responseBody);
	});

	await t.throwsAsync(
		ky.post(server.url, {
			hooks: {
				beforeError: [
					async (error: HTTPError) => {
						const {response} = error;
						const body = await response.json() as {reason: string};

						if (response?.body) {
							error.name = 'GitHubError';
							error.message = `${body.reason} --- (${response.status})`.trim();
						}

						return error;
					},
				],
			},
		}),
		{
			name: 'GitHubError',
			message: `${responseBody.reason} --- (500)`,
		},
	);

	await server.close();
});
