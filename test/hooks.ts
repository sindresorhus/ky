import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import ky, {
	HTTPError,
	KyError,
	isHTTPError,
	isTimeoutError,
	isForceRetryError,
	TimeoutError,
} from '../source/index.js';
import {type Options} from '../source/types/options.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const createStreamBody = (text: string) => new ReadableStream<Uint8Array>({
	start(controller) {
		controller.enqueue(new TextEncoder().encode(text));
		controller.close();
	},
});

const createStreamFetch = ({
	text = 'ok',
	onResponse,
}: {
	text?: string;
	onResponse?: (response: Response) => void;
} = {}): typeof fetch => async request => {
	if (!(request instanceof Request)) {
		throw new TypeError('Expected input to be a Request');
	}

	const response = new Response(createStreamBody(text));
	onResponse?.(response);
	return response;
};

test('hooks can be async', async t => {
	const server = await createHttpTestServer(t);
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
					async ({request, options}) => {
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
});

test('hooks can be empty object', async t => {
	const expectedResponse = 'empty hook';
	const server = await createHttpTestServer(t);

	server.get('/', (_request, response) => {
		response.end(expectedResponse);
	});

	const response = await ky.get(server.url, {hooks: {}}).text();

	t.is(response, expectedResponse);
});

test('beforeRequest hook allows modifications', async t => {
	const server = await createHttpTestServer(t);
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
					({request, options}) => {
						const bodyJson = JSON.parse(options.body as string);
						bodyJson.foo = false;
						return new Request(request, {body: JSON.stringify(bodyJson)});
					},
				],
			},
		})
		.json<typeof json>();

	t.false(responseJson.foo);
});

test('afterResponse hook accepts success response', async t => {
	const server = await createHttpTestServer(t);
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
						async ({response}) => {
							t.is(response.status, 200);
							t.deepEqual(await response.json(), json);
						},
					],
				},
			})
			.json(),
	);
});

test('afterResponse hook cancels unused cloned response body', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('ok');
	});

	let didCancelClonedResponseBody = false;

	await ky.get(server.url, {
		hooks: {
			afterResponse: [
				async ({response}) => {
					if (response.body) {
						const originalCancel = response.body.cancel.bind(response.body);
						response.body.cancel = async () => {
							didCancelClonedResponseBody = true;
							return originalCancel();
						};
					}
				},
			],
		},
	}).text();

	t.true(didCancelClonedResponseBody);
});

test('afterResponse hook cancels both clone and original when it returns a new response', async t => {
	let originalResponse: Response | undefined;
	let clonedResponse: Response | undefined;

	const customFetch = createStreamFetch({
		onResponse(response) {
			originalResponse = response;
		},
	});

	const responseText = await ky('https://example.com', {
		fetch: customFetch,
		hooks: {
			afterResponse: [
				({response}) => {
					clonedResponse = response;
					return new Response('replacement');
				},
			],
		},
	}).text();

	t.is(responseText, 'replacement');
	t.true(originalResponse?.bodyUsed);
	t.true(clonedResponse?.bodyUsed);
});

test('afterResponse hook can return the provided response', async t => {
	let originalResponse: Response | undefined;

	const customFetch = createStreamFetch({
		onResponse(response) {
			originalResponse = response;
		},
	});

	const responseText = await ky('https://example.com', {
		fetch: customFetch,
		hooks: {
			afterResponse: [
				({response}) => response,
			],
		},
	}).text();

	t.is(responseText, 'ok');
	t.true(originalResponse?.bodyUsed);
});

test('afterResponse hook with multiple hooks cancels all unused clones', async t => {
	let originalResponse: Response | undefined;
	const clones: Response[] = [];

	const customFetch = createStreamFetch({
		onResponse(response) {
			originalResponse = response;
		},
	});

	const responseText = await ky('https://example.com', {
		fetch: customFetch,
		hooks: {
			afterResponse: [
				({response}) => {
					clones.push(response);
					// Return nothing - clone should be cancelled
				},
				({response}) => {
					clones.push(response);
					// Return nothing - clone should be cancelled
				},
				({response}) => {
					clones.push(response);
					// Return nothing - clone should be cancelled
				},
			],
		},
	}).text();

	t.is(responseText, 'ok');
	t.is(clones.length, 3);

	// All clones should be cancelled (bodyUsed becomes true after cancel)
	for (const clone of clones) {
		t.true(clone.bodyUsed);
	}
});

test('afterResponse hook cancels response bodies when it throws', async t => {
	let originalResponse: Response | undefined;
	let clonedResponse: Response | undefined;

	const customFetch = createStreamFetch({
		onResponse(response) {
			originalResponse = response;
		},
	});

	const expectError = new Error('Hook error');

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			hooks: {
				afterResponse: [
					({response}) => {
						clonedResponse = response;
						throw expectError;
					},
				],
			},
		}).text(),
		{is: expectError},
	);

	t.true(originalResponse?.bodyUsed);
	t.true(clonedResponse?.bodyUsed);
});

test('afterResponse hook accepts failed response', async t => {
	const server = await createHttpTestServer(t);
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
						async ({response}) => {
							t.is(response.status, 500);
							t.deepEqual(await response.json(), json);
						},
					],
				},
			})
			.json(),
	);
});

test('afterResponse hook can change response instance by sequence', async t => {
	const server = await createHttpTestServer(t);
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
						async ({response}) => {
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
});

test('afterResponse hook can throw error to reject the request promise', async t => {
	const server = await createHttpTestServer(t);
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
});

test('`afterResponse` hook gets called even if using body shortcuts', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({});
	});

	let called = false;
	await ky
		.get(server.url, {
			hooks: {
				afterResponse: [
					({response}) => {
						called = true;
						return response;
					},
				],
			},
		})
		.json();

	t.true(called);
});

test('`afterResponse` hook is called with request, normalized options, and response which can be used to retry', async t => {
	const server = await createHttpTestServer(t);
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
						async ({request, options, response}) => {
							if (response.status === 403) {
								// Retry request with valid token
								return ky(request, {
									...options,
									json: {
										...json,
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
});

test('afterResponse hook with parseJson and response.json()', async t => {
	t.plan(5);

	const server = await createHttpTestServer(t);
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
					async ({response}) => {
						t.true(response instanceof Response);
						t.deepEqual(await response.json(), {awesome: true});
					},
				],
			},
		})
		.json();

	t.deepEqual(json, {awesome: true});
});

test('beforeRetry hook is never called for the initial request', async t => {
	const fixture = 'fixture';
	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		response.end(request.headers.unicorn);
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
});

test('beforeRequest hook on initial request cannot bypass total timeout budget', async t => {
	let fetchCallCount = 0;

	const customFetch: typeof fetch = async () => {
		fetchCallCount++;
		return new Response('ok');
	};

	const error = await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: 100,
			hooks: {
				beforeRequest: [
					async () => {
						await delay(200);
					},
				],
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.true(error instanceof TimeoutError);
	t.is(fetchCallCount, 0);
});

test('beforeRequest hook on retry cannot bypass total timeout budget', async t => {
	let fetchCallCount = 0;

	const customFetch: typeof fetch = async () => {
		fetchCallCount++;
		if (fetchCallCount === 1) {
			return new Response('first-attempt', {status: 500});
		}

		return new Response('second-attempt-success');
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: 100,
			retry: {
				limit: 1,
				delay: () => 0,
			},
			hooks: {
				beforeRequest: [
					async ({retryCount}) => {
						if (retryCount > 0) {
							await delay(200);
						}
					},
				],
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.is(fetchCallCount, 1);
});

test('beforeRetry hook allows modifications of non initial requests', async t => {
	let requestCount = 0;

	const fixture = 'fixture';
	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 1) {
			response.end(request.headers.unicorn);
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
});

test('beforeRetry hook is called with error and retryCount', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 1) {
			response.end(request.headers.unicorn);
		} else {
			response.sendStatus(408);
		}
	});

	await ky.get(server.url, {
		hooks: {
			beforeRetry: [
				({error, retryCount}) => {
					t.true(error instanceof HTTPError);
					t.true(isHTTPError(error));
					t.true(retryCount >= 1);
				},
			],
		},
	});
});

test('beforeRetry hook is called even if the error has no response', async t => {
	t.plan(6);

	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		response.end('unicorn');
	});

	const text = await ky
		.get(server.url, {
			retry: 1,
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
});

test('beforeRetry hook with parseJson and error.data', async t => {
	t.plan(11);

	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.status(502).type('application/json').send('text');
		} else {
			response.end('text');
		}
	});

	const json = await ky
		.get(server.url, {
			retry: 1,
			parseJson(text) {
				t.is(text, 'text');
				return {awesome: true};
			},
			hooks: {
				beforeRetry: [
					async ({error, retryCount}) => {
						t.true(error instanceof HTTPError);
						t.true(isHTTPError(error));
						t.is(error.message, `Request failed with status code 502 Bad Gateway: GET ${server.url}/`);
						t.true((error as HTTPError).response instanceof Response);
						t.deepEqual((error as HTTPError).data, {awesome: true});
						t.is(retryCount, 1);
						t.is(requestCount, 1);
					},
				],
			},
		})
		.json();

	t.deepEqual(json, {awesome: true});
	t.is(requestCount, 2);
});

test('beforeRetry hook with async parseJson and error.data', async t => {
	t.plan(12);

	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.status(502).type('application/json').send('text');
		} else {
			response.end('text');
		}
	});

	const json = await ky
		.get(server.url, {
			retry: 1,
			async parseJson(text) {
				t.is(text, 'text');
				await Promise.resolve();
				return {awesome: true};
			},
			hooks: {
				beforeRetry: [
					async ({error, retryCount}) => {
						t.true(error instanceof HTTPError);
						t.true(isHTTPError(error));
						t.is(error.message, `Request failed with status code 502 Bad Gateway: GET ${server.url}/`);
						t.true((error as HTTPError).response instanceof Response);
						t.deepEqual((error as HTTPError).data, {awesome: true});
						t.false((error as HTTPError).data instanceof Promise);
						t.is(retryCount, 1);
						t.is(requestCount, 1);
					},
				],
			},
		})
		.json();

	t.deepEqual(json, {awesome: true});
	t.is(requestCount, 2);
});

test('beforeRetry hook gets HTTPError when async parseJson rejects', async t => {
	t.plan(7);

	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.status(502).type('application/json').send('text');
		} else {
			response.end('ok');
		}
	});

	const text = await ky
		.get(server.url, {
			retry: 1,
			async parseJson() {
				throw new Error('custom parse failure');
			},
			hooks: {
				beforeRetry: [
					({error, retryCount}) => {
						t.true(error instanceof HTTPError);
						t.true(isHTTPError(error));
						t.is((error as HTTPError).data, undefined);
						t.is(retryCount, 1);
						t.is(requestCount, 1);
					},
				],
			},
		})
		.text();

	t.is(text, 'ok');
	t.is(requestCount, 2);
});

test('beforeRetry hook can cancel retries by returning `stop`', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 2) {
			response.end(request.headers.unicorn);
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
});

test('beforeRetry hook respects total timeout budget', async t => {
	let fetchCallCount = 0;
	let beforeRetryCallCount = 0;

	const customFetch: typeof fetch = async () => {
		fetchCallCount++;
		if (fetchCallCount === 1) {
			return new Response('first-attempt', {status: 500});
		}

		return new Response('second-attempt-success');
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: 1000,
			retry: {
				limit: 1,
				delay: () => 0,
			},
			hooks: {
				beforeRetry: [
					async () => {
						beforeRetryCallCount++;
						await delay(2000);
					},
				],
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.is(beforeRetryCallCount, 1);
	t.is(fetchCallCount, 1);
});

test('catches beforeRetry thrown errors', async t => {
	let requestCount = 0;
	let beforeErrorHookCalled = false;

	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 1) {
			response.end(request.headers.unicorn);
		} else {
			response.sendStatus(408);
		}
	});

	const errorString = 'oops';
	const error = new Error(errorString);

	const thrownError = await t.throwsAsync(
		ky.get(server.url, {
			hooks: {
				beforeRetry: [
					() => {
						throw error;
					},
				],
				beforeError: [
					() => {
						beforeErrorHookCalled = true;
						return new Error('beforeError should not run');
					},
				],
			},
		}),
		{message: errorString},
	);

	t.is(thrownError, error);
	t.false(beforeErrorHookCalled);
});

test('catches beforeRetry promise rejections', async t => {
	let requestCount = 0;
	let beforeErrorHookCalled = false;

	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount > 1) {
			response.end(request.headers.unicorn);
		} else {
			response.sendStatus(408);
		}
	});

	const errorString = 'oops';
	const error = new Error(errorString);

	const thrownError = await t.throwsAsync(
		ky.get(server.url, {
			hooks: {
				beforeRetry: [
					async () => {
						throw error;
					},
				],
				beforeError: [
					() => {
						beforeErrorHookCalled = true;
						return new Error('beforeError should not run');
					},
				],
			},
		}),
		{message: errorString},
	);

	t.is(thrownError, error);
	t.false(beforeErrorHookCalled);
});

test('beforeError runs when beforeRetry rethrows the request error', async t => {
	let beforeErrorHookCalled = false;
	let beforeErrorRetryCount = -1;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.sendStatus(408);
	});

	const thrownError = await t.throwsAsync(
		ky.get(server.url, {
			hooks: {
				beforeRetry: [
					({error}) => {
						throw error;
					},
				],
				beforeError: [
					({error, retryCount}) => {
						beforeErrorHookCalled = true;
						beforeErrorRetryCount = retryCount;
						error.message = 'modified-by-beforeError';
						return error;
					},
				],
			},
		}),
		{message: 'modified-by-beforeError'},
	);

	t.true(beforeErrorHookCalled);
	t.is(beforeErrorRetryCount, 0);
	t.true(isHTTPError(thrownError));
});

test('beforeError is not called when beforeRetry throws non-Error', async t => {
	let beforeErrorHookCalled = false;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.sendStatus(408);
	});

	let thrownError: unknown;
	try {
		await ky.get(server.url, {
			hooks: {
				beforeRetry: [
					() => {
						throw 'oops' as unknown as Error;
					},
				],
				beforeError: [
					() => {
						beforeErrorHookCalled = true;
						return new Error('beforeError should not run');
					},
				],
			},
		});
	} catch (error) {
		thrownError = error;
	}

	t.is(thrownError, 'oops');
	t.false(beforeErrorHookCalled);
});

test('beforeError runs when beforeRetry rethrows TimeoutError', async t => {
	let beforeErrorHookCalled = false;
	let beforeRetryHookCalled = false;

	const customFetch: typeof fetch = async request => {
		throw new TimeoutError(request as Request);
	};

	const thrownError = await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: 1000,
			retry: {
				limit: 1,
				delay: () => 0,
				retryOnTimeout: true,
			},
			hooks: {
				beforeRetry: [
					({error}) => {
						beforeRetryHookCalled = true;
						t.true(isTimeoutError(error));
						throw error;
					},
				],
				beforeError: [
					({error}) => {
						beforeErrorHookCalled = true;
						if (isTimeoutError(error)) {
							error.message = 'timeout-modified-by-beforeError';
						}

						return error;
					},
				],
			},
		}).text(),
		{message: 'timeout-modified-by-beforeError'},
	);

	t.true(beforeRetryHookCalled);
	t.true(beforeErrorHookCalled);
	t.true(isTimeoutError(thrownError));
});

test('beforeError runs when beforeRetry rethrows ForceRetryError', async t => {
	let beforeErrorHookCalled = false;
	let beforeRetryHookCalled = false;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.sendStatus(200);
	});

	const thrownError = await t.throwsAsync(
		ky.get(server.url, {
			retry: {
				limit: 1,
				delay: () => 0,
			},
			hooks: {
				afterResponse: [
					() => ky.retry(),
				],
				beforeRetry: [
					({error}) => {
						beforeRetryHookCalled = true;
						t.true(isForceRetryError(error));
						throw error;
					},
				],
				beforeError: [
					({error}) => {
						beforeErrorHookCalled = true;
						if (isForceRetryError(error)) {
							error.message = 'force-retry-modified-by-beforeError';
						}

						return error;
					},
				],
			},
		}),
		{message: 'force-retry-modified-by-beforeError'},
	);

	t.true(beforeRetryHookCalled);
	t.true(beforeErrorHookCalled);
	t.true(isForceRetryError(thrownError));
});

test('beforeError runs when beforeRetry rethrows network errors', async t => {
	let beforeErrorHookCalled = false;

	const customFetch: typeof fetch = async () => {
		throw new TypeError('network-down');
	};

	const thrownError = await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			retry: {
				limit: 1,
				delay: () => 0,
			},
			hooks: {
				beforeRetry: [
					({error}) => {
						throw error;
					},
				],
				beforeError: [
					({error}) => {
						beforeErrorHookCalled = true;
						error.message = 'network-modified-by-beforeError';
						return error;
					},
				],
			},
		}),
		{message: 'network-modified-by-beforeError'},
	);

	t.true(beforeErrorHookCalled);
	t.true(thrownError instanceof TypeError);
});

test('hooks beforeRequest returning Response skips HTTP Request', async t => {
	const expectedResponse = 'empty hook';

	const response = await ky
		.get('https://example.com', {
			hooks: {
				beforeRequest: [() => new Response(expectedResponse, {status: 200, statusText: 'OK'})],
			},
		})
		.text();

	t.is(response, expectedResponse);
});

test('runs beforeError before throwing HTTPError', async t => {
	const server = await createHttpTestServer(t);
	server.post('/', (_request, response) => {
		response.status(500).send();
	});

	await t.throwsAsync(
		ky.post(server.url, {
			hooks: {
				beforeError: [
					({error}) => {
						if (isHTTPError(error)) {
							const {response} = error;

							if (response?.body) {
								error.name = 'GitHubError';
								error.message = `${response.statusText} --- (${response.status})`.trim();
							}
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
});

test('beforeError can return promise which resolves to HTTPError', async t => {
	const server = await createHttpTestServer(t);
	const responseBody = {reason: 'github down'};
	server.post('/', (_request, response) => {
		response.status(500).send(responseBody);
	});

	await t.throwsAsync(
		ky.post(server.url, {
			hooks: {
				beforeError: [
					async ({error}) => {
						if (isHTTPError(error)) {
							const body = error.data as {reason: string};

							error.name = 'GitHubError';
							error.message = `${body.reason} --- (${error.response.status})`.trim();
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
});

test('beforeRequest hook receives retryCount parameter', async t => {
	let requestCount = 0;
	const retryCounts: number[] = [];

	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		requestCount++;

		if (requestCount === 1) {
			// First request fails
			response.sendStatus(408);
		} else {
			// Retry succeeds, return the auth header that was sent
			response.end(request.headers.authorization);
		}
	});

	const result = await ky.get(server.url, {
		hooks: {
			beforeRequest: [
				({request, retryCount}) => {
					retryCounts.push(retryCount);
					// Only set default token on initial request
					if (retryCount === 0) {
						request.headers.set('Authorization', 'token initial-token');
					}
				},
			],
			beforeRetry: [
				({request}) => {
					// Refresh token on retry
					request.headers.set('Authorization', 'token refreshed-token');
				},
			],
		},
	}).text();

	// Verify beforeRequest was called twice with correct retryCount values
	t.deepEqual(retryCounts, [0, 1]);
	t.is(requestCount, 2);
	// Verify the refreshed token was used, not the initial token
	t.is(result, 'token refreshed-token');
});

test('Ky-specific options are not included in normalized options passed to hooks', async t => {
	const server = await createHttpTestServer(t);
	server.post('/', (_request, response) => {
		response.end('ok');
	});

	await ky.post(server.url, {
		json: {key: 'value'},
		searchParams: {foo: 'bar'},
		parseJson: JSON.parse,
		stringifyJson: JSON.stringify,
		timeout: 5000,
		throwHttpErrors: false,
		hooks: {
			beforeRequest: [
				({options}) => {
					// Verify Ky-specific properties are not present
					t.false('hooks' in options);
					t.false('json' in options);
					t.false('parseJson' in options);
					t.false('stringifyJson' in options);
					t.false('searchParams' in options);
					t.false('timeout' in options);
					t.false('throwHttpErrors' in options);
					t.false('fetch' in options);

					// Verify options object is frozen (can't add/modify properties)
					t.throws(() => {
						// @ts-expect-error - Testing freeze behavior
						options.newProperty = 'test';
					});

					// Verify nested objects like headers are still mutable
					t.notThrows(() => {
						options.headers.set('X-Test', 'value');
					});
				},
			],
		},
	});
});

test('afterResponse hook receives retryCount in state parameter', async t => {
	let requestCount = 0;
	const retryCounts: number[] = [];

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount <= 2) {
			// First two requests fail
			response.sendStatus(500);
		} else {
			// Third request succeeds
			response.end('success');
		}
	});

	await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				({retryCount}) => {
					t.is(typeof retryCount, 'number');
					retryCounts.push(retryCount);
				},
			],
		},
	});

	// AfterResponse should be called 3 times (initial + 2 retries)
	t.is(requestCount, 3);
	t.deepEqual(retryCounts, [0, 1, 2]);
});

test('beforeError hook receives retryCount in state parameter', async t => {
	let requestCount = 0;
	let errorRetryCount: number | undefined;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		// All requests fail
		response.sendStatus(500);
	});

	try {
		await ky.get(server.url, {
			retry: {
				limit: 2,
			},
			hooks: {
				beforeError: [
					({error, retryCount}) => {
						// Verify retryCount exists in state and is a number
						t.is(typeof retryCount, 'number');
						t.true(retryCount >= 0);
						errorRetryCount = retryCount;
						return error;
					},
				],
			},
		});
		t.fail('Should have thrown an error');
	} catch (error: any) {
		t.true(error instanceof HTTPError);
		// State should have had retryCount = 2 (after 2 retries)
		t.is(errorRetryCount, 2);
	}

	// Should have made 3 requests total (initial + 2 retries)
	t.is(requestCount, 3);
});

test('beforeError hook receives TimeoutError', async t => {
	let receivedError: Error | undefined;

	await t.throwsAsync(
		ky('https://example.com', {
			timeout: 1,
			async fetch() {
				await new Promise(resolve => {
					setTimeout(resolve, 1000);
				});
				return new Response('ok');
			},
			hooks: {
				beforeError: [
					({error}) => {
						receivedError = error;
						return error;
					},
				],
			},
		}),
		{
			name: 'TimeoutError',
		},
	);

	t.truthy(receivedError);
	t.true(receivedError instanceof TimeoutError);
	t.true(isTimeoutError(receivedError));
	t.true(receivedError instanceof KyError);
});

test('beforeError hook can modify TimeoutError', async t => {
	await t.throwsAsync(
		ky('https://example.com', {
			timeout: 1,
			async fetch() {
				await new Promise(resolve => {
					setTimeout(resolve, 1000);
				});
				return new Response('ok');
			},
			hooks: {
				beforeError: [
					({error}) => {
						if (isTimeoutError(error)) {
							error.name = 'CustomTimeoutError';
							error.message = 'Custom timeout message';
						}

						return error;
					},
				],
			},
		}),
		{
			name: 'CustomTimeoutError',
			message: 'Custom timeout message',
		},
	);
});

test('beforeError hook receives network errors', async t => {
	let receivedError: Error | undefined;
	let receivedRetryCount: number | undefined;

	await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				throw new TypeError('Failed to fetch');
			},
			hooks: {
				beforeError: [
					({error, retryCount}) => {
						receivedError = error;
						receivedRetryCount = retryCount;
						return error;
					},
				],
			},
		}),
	);

	t.truthy(receivedError);
	t.is(receivedError!.message, 'Failed to fetch');
	t.is(receivedRetryCount, 0);
});

test('beforeError hook retryCount reflects actual retry count for network errors', async t => {
	let errorRetryCount: number | undefined;

	await t.throwsAsync(
		ky('https://example.com', {
			retry: {
				limit: 2,
				delay: () => 0,
			},
			async fetch() {
				throw new TypeError('Failed to fetch');
			},
			hooks: {
				beforeError: [
					({error, retryCount}) => {
						errorRetryCount = retryCount;
						return error;
					},
				],
			},
		}),
	);

	t.is(errorRetryCount, 2);
});

test('beforeError hook retryCount reflects actual retry count for TimeoutError', async t => {
	let errorRetryCount: number | undefined;

	await t.throwsAsync(
		ky('https://example.com', {
			timeout: 50,
			retry: {
				limit: 2,
				retryOnTimeout: true,
				delay: () => 0,
			},
			async fetch() {
				await new Promise(resolve => {
					setTimeout(resolve, 2000);
				});
				return new Response('ok');
			},
			hooks: {
				beforeError: [
					({error, retryCount}) => {
						errorRetryCount = retryCount;
						return error;
					},
				],
			},
		}),
		{
			name: 'TimeoutError',
		},
	);

	// The 50ms total timeout budget is exhausted before any retry can complete,
	// so retryCount is 0.
	t.is(errorRetryCount, 0);
});

test('beforeError hook can replace error with a different type', async t => {
	class CustomError extends Error {
		override name = 'CustomError';
		code: string;

		constructor(message: string, code: string) {
			super(message);
			this.code = code;
		}
	}

	const error = await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				throw new TypeError('Failed to fetch');
			},
			hooks: {
				beforeError: [
					() => new CustomError('Connection failed', 'NETWORK_ERROR'),
				],
			},
		}),
	);

	t.true(error instanceof CustomError);
	t.is(error!.message, 'Connection failed');
	t.is((error as CustomError).code, 'NETWORK_ERROR');
});

test('beforeError hooks chain correctly - second hook receives error from first', async t => {
	const hookOrder: string[] = [];

	await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				return new Response('', {status: 500});
			},
			hooks: {
				beforeError: [
					({error}) => {
						hookOrder.push('first');
						if (isHTTPError(error)) {
							error.message = 'modified by first hook';
						}

						return error;
					},
					({error}) => {
						hookOrder.push('second');
						t.is(error.message, 'modified by first hook');
						return error;
					},
				],
			},
		}),
		{
			message: 'modified by first hook',
		},
	);

	t.deepEqual(hookOrder, ['first', 'second']);
});

test('beforeError hooks are not called for non-Error throws', async t => {
	let hookCalled = false;

	try {
		await ky('https://example.com', {
			retry: 0,
			async fetch() {
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw 'network down';
			},
			hooks: {
				beforeError: [
					({error}) => {
						hookCalled = true;
						return error;
					},
				],
			},
		});
		t.fail('Should have thrown');
	} catch (error) {
		t.is(error, 'network down');
	}

	t.false(hookCalled);
});

test('beforeError hook receives ForceRetryError when retry limit is exhausted', async t => {
	let hookCalled = false;
	let receivedError: Error | undefined;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('ok');
	});

	const error = await t.throwsAsync(
		ky.get(server.url, {
			retry: {
				limit: 1,
			},
			hooks: {
				afterResponse: [
					() => ky.retry(),
				],
				beforeError: [
					({error}) => {
						hookCalled = true;
						receivedError = error;
						return error;
					},
				],
			},
		}),
	);

	t.true(hookCalled);
	t.true(isForceRetryError(receivedError));
	t.true(isForceRetryError(error));
});

test('beforeError hook that throws replaces the original error', async t => {
	const error = await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				return new Response('', {status: 500});
			},
			hooks: {
				beforeError: [
					() => {
						throw new RangeError('hook blew up');
					},
				],
			},
		}),
	);

	t.true(error instanceof RangeError);
	t.is(error!.message, 'hook blew up');
});

test('beforeError hook that throws asynchronously replaces the original error', async t => {
	const error = await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				return new Response('', {status: 500});
			},
			hooks: {
				beforeError: [
					async () => {
						await Promise.resolve();
						throw new RangeError('async hook blew up');
					},
				],
			},
		}),
	);

	t.true(error instanceof RangeError);
	t.is(error!.message, 'async hook blew up');
});

test('beforeError hooks from ky.extend() are merged and called in order', async t => {
	const hookOrder: string[] = [];

	const api = ky.extend({
		hooks: {
			beforeError: [
				({error}) => {
					hookOrder.push('parent');
					return error;
				},
			],
		},
	});

	await t.throwsAsync(
		api('https://example.com', {
			retry: 0,
			async fetch() {
				return new Response('', {status: 500});
			},
			hooks: {
				beforeError: [
					({error}) => {
						hookOrder.push('child');
						return error;
					},
				],
			},
		}),
	);

	t.deepEqual(hookOrder, ['parent', 'child']);
});

test('beforeError hook receives errors thrown by beforeRequest hooks', async t => {
	let receivedError: Error | undefined;
	const beforeRequestError = new Error('beforeRequest hook failed');

	await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				return new Response('ok');
			},
			hooks: {
				beforeRequest: [
					() => {
						throw beforeRequestError;
					},
				],
				beforeError: [
					({error}) => {
						receivedError = error;
						return error;
					},
				],
			},
		}),
	);

	t.is(receivedError, beforeRequestError);
});

test('beforeError hook is not called when throwHttpErrors is false', async t => {
	let hookCalled = false;

	const response = await ky('https://example.com', {
		throwHttpErrors: false,
		retry: 0,
		async fetch() {
			return new Response('', {status: 500});
		},
		hooks: {
			beforeError: [
				({error}) => {
					hookCalled = true;
					return error;
				},
			],
		},
	});

	t.is(response.status, 500);
	t.false(hookCalled);
});

test('beforeRetry hook can return modified Request with new URL', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		requestCount++;

		// Check if the required query parameter is present
		const url = new URL(request.url, `http://${request.headers.host}`);
		const processId = url.searchParams.get('processId');

		if (processId === '2222') {
			response.end('success');
		} else {
			response.sendStatus(500);
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 1,
		},
		hooks: {
			beforeRetry: [
				({request}) => {
					// Return a new Request with the required query parameter
					const url = new URL(request.url);
					url.searchParams.set('processId', '2222');
					return new Request(url, request);
				},
			],
		},
	}).text();

	t.is(result, 'success');
	t.is(requestCount, 2); // Initial request + 1 retry
});

test('beforeRetry hook can return Response to skip retry', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(500);
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 3,
		},
		hooks: {
			beforeRetry: [
				() => new Response('fallback', {status: 200}),
			],
		},
	}).text();

	t.is(result, 'fallback');
	t.is(requestCount, 1); // Only initial request, no retry
});

test('beforeRetry hook returning Request/Response stops processing remaining hooks', async t => {
	let requestCount = 0;
	let firstHookCalled = false;
	let secondHookCalled = false;

	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		requestCount++;

		if (request.headers['x-first-hook']) {
			response.end('success');
		} else {
			response.sendStatus(500);
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 1,
		},
		hooks: {
			beforeRetry: [
				({request}) => {
					firstHookCalled = true;
					const newRequest = new Request(request.url, request);
					newRequest.headers.set('x-first-hook', 'true');
					return newRequest;
				},
				() => {
					secondHookCalled = true;
				},
			],
		},
	}).text();

	t.is(result, 'success');
	t.true(firstHookCalled);
	t.false(secondHookCalled);
	t.is(requestCount, 2); // Initial request + 1 retry
});

test('afterResponse hook can force retry with ky.retry()', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			// First request returns 200 with error in body
			response.json({error: {code: 'RATE_LIMIT'}});
		} else {
			// Second request succeeds
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'RATE_LIMIT') {
						return ky.retry();
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2); // Initial request + 1 retry
});

test('afterResponse hook forced retry does not await cancellation when hook clones response', async t => {
	t.timeout(1000);

	let requestCount = 0;

	const customFetch = async () => {
		requestCount++;

		if (requestCount === 1) {
			return new Response('unauthorized', {status: 401});
		}

		return new Response('ok');
	};

	const result = await ky('https://example.test', {
		fetch: customFetch,
		hooks: {
			afterResponse: [
				({response}) => {
					response.clone();
					if (response.status === 401) {
						return ky.retry();
					}
				},
			],
		},
	}).text();

	t.is(result, 'ok');
	t.is(requestCount, 2);
});

test('afterResponse hook can force retry with custom delay', async t => {
	let requestCount = 0;
	const customDelay = 100;
	const startTime = Date.now();

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.json({error: {code: 'RATE_LIMIT', retryAfter: customDelay / 1000}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'RATE_LIMIT') {
						return ky.retry({
							delay: data.error.retryAfter * 1000,
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	const elapsedTime = Date.now() - startTime;

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2);
	t.true(elapsedTime >= customDelay); // Verify custom delay was used
});

test('afterResponse forced retry respects total timeout budget', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;
		response.json({error: {code: 'RETRY_WITH_DELAY'}});
	});

	await t.throwsAsync(
		ky.get(server.url, {
			timeout: 100,
			retry: {
				limit: 3,
			},
			hooks: {
				afterResponse: [
					async ({response}) => {
						const data = await response.clone().json();
						if (data.error?.code === 'RETRY_WITH_DELAY') {
							return ky.retry({delay: 200});
						}
					},
				],
			},
		}),
		{
			name: 'TimeoutError',
		},
	);

	t.true(requestCount <= 1);

	await server.close();
});

test('afterResponse hook forced retry respects retry limit', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		// Always return error to trigger retry
		response.json({error: {code: 'RATE_LIMIT'}});
	});

	await t.throwsAsync(
		ky.get(server.url, {
			retry: {
				limit: 2,
			},
			hooks: {
				afterResponse: [
					async ({response}) => {
						const data = await response.clone().json();
						if (data.error?.code === 'RATE_LIMIT') {
							return ky.retry();
						}
					},
				],
			},
		}),
		{
			name: 'ForceRetryError',
		},
	);

	t.is(requestCount, 3); // Initial request + 2 retries (limit reached)
});

test('afterResponse hook forced retry is observable in beforeRetry', async t => {
	let requestCount = 0;
	let beforeRetryCallCount = 0;
	let errorName: string | undefined;
	let errorMessage: string | undefined;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.json({error: {code: 'RATE_LIMIT'}});
		} else {
			response.json({success: true});
		}
	});

	await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'RATE_LIMIT') {
						return ky.retry({code: 'RATE_LIMIT'});
					}
				},
			],
			beforeRetry: [
				({error, retryCount}) => {
					beforeRetryCallCount++;
					errorName = error.name;
					errorMessage = error.message;
					t.is(retryCount, 1);
				},
			],
		},
	});

	t.is(requestCount, 2);
	t.is(beforeRetryCallCount, 1);
	t.is(errorName, 'ForceRetryError');
	t.is(errorMessage, 'Forced retry: RATE_LIMIT');
});

test('afterResponse hook forced retry skips shouldRetry check', async t => {
	let requestCount = 0;
	let shouldRetryCalled = false;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.json({error: {code: 'CUSTOM_ERROR'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 2,
			shouldRetry() {
				shouldRetryCalled = true;
				return false; // Would prevent retry, but ky.retry() bypasses this
			},
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'CUSTOM_ERROR') {
						return ky.retry();
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2); // Retry happened despite shouldRetry returning false
	t.false(shouldRetryCalled); // ShouldRetry was never called because ky.retry() bypasses it
});

test('afterResponse hook forced retry works on non-retriable methods like POST', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.post('/', async (request, response) => {
		requestCount++;

		if (requestCount === 1) {
			// First request returns 200 with error in body
			response.json({error: {code: 'RATE_LIMIT'}});
		} else {
			// Second request succeeds
			response.json({success: true});
		}
	});

	// POST is not in retry.methods by default, but ky.retry() should override this
	const result = await ky.post(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'RATE_LIMIT') {
						return ky.retry();
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2); // Should retry even though POST is not retriable by default
});

test('afterResponse hook forced retry stops processing remaining hooks', async t => {
	let requestCount = 0;
	let firstHookCallCount = 0;
	let secondHookCallCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.json({error: {code: 'RATE_LIMIT'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					firstHookCallCount++;
					const data = await response.clone().json();
					if (data.error?.code === 'RATE_LIMIT') {
						return ky.retry();
					}
				},
				() => {
					secondHookCallCount++;
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(firstHookCallCount, 2); // Called on both requests
	t.is(secondHookCallCount, 1); // Only called on second request (not first, because first hook returned ky.retry())
});

test('afterResponse hook forced retry works with delay: 0 (instant retry)', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.json({error: {code: 'RETRY_NOW'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'RETRY_NOW') {
						return ky.retry({delay: 0}); // Instant retry, no delay
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2);
});

test('afterResponse hook can force retry with custom request (different URL)', async t => {
	let primaryRequestCount = 0;
	let backupRequestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/primary', (_request, response) => {
		primaryRequestCount++;
		response.json({error: {code: 'FALLBACK_TO_BACKUP'}});
	});

	server.get('/backup', (_request, response) => {
		backupRequestCount++;
		response.json({success: true});
	});

	const result = await ky.get(`${server.url}/primary`, {
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'FALLBACK_TO_BACKUP') {
						return ky.retry({
							request: new Request(`${server.url}/backup`, {
								method: request.method,
								headers: request.headers,
							}),
							code: 'BACKUP_ENDPOINT',
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(primaryRequestCount, 1);
	t.is(backupRequestCount, 1);
});

test('afterResponse hook can force retry with custom request (modified headers)', async t => {
	const receivedHeaders: Array<string | undefined> = [];

	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		receivedHeaders.push(request.headers['x-auth-token']);

		if (receivedHeaders.length === 1) {
			response.json({error: {code: 'TOKEN_REFRESH', newToken: 'refreshed-token-123'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		headers: {'X-Auth-Token': 'original-token'},
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'TOKEN_REFRESH' && data.error.newToken) {
						return ky.retry({
							request: new Request(request, {
								headers: {
									...Object.fromEntries(request.headers),
									'x-auth-token': data.error.newToken,
								},
							}),
							code: 'TOKEN_REFRESHED',
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.deepEqual(receivedHeaders, ['original-token', 'refreshed-token-123']);
});

test('afterResponse hook can force retry with custom request (different HTTP method)', async t => {
	const receivedMethods: string[] = [];

	const server = await createHttpTestServer(t);
	server.post('/', (request, response) => {
		receivedMethods.push(request.method);
		if (receivedMethods.length === 1) {
			response.json({error: {code: 'METHOD_OVERLOAD'}});
		} else {
			response.status(404).end();
		}
	});

	server.put('/', (request, response) => {
		receivedMethods.push(request.method);
		response.json({success: true});
	});

	const result = await ky.post(server.url, {
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'METHOD_OVERLOAD' && request.method === 'POST') {
						return ky.retry({
							request: new Request(request, {
								method: 'PUT',
							}),
							code: 'SWITCH_TO_PUT',
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.deepEqual(receivedMethods, ['POST', 'PUT']);
});

test('afterResponse hook custom request works with beforeRetry hooks', async t => {
	let beforeRetryWasCalled = false;
	let errorWasForceRetryError = false;
	let errorReason;
	const finalHeaders: Array<string | undefined> = [];

	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		finalHeaders.push(request.headers['x-custom'], request.headers['x-retry']);

		if (finalHeaders.length === 2) {
			response.json({error: {code: 'RETRY_WITH_CUSTOM_REQUEST'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'RETRY_WITH_CUSTOM_REQUEST') {
						return ky.retry({
							request: new Request(request, {
								headers: {
									...Object.fromEntries(request.headers),
									'X-Custom': 'from-afterResponse',
								},
							}),
							code: 'HOOK_COMPOSITION_TEST',
						});
					}
				},
			],
			beforeRetry: [
				({request, error}) => {
					beforeRetryWasCalled = true;
					errorWasForceRetryError = isForceRetryError(error);
					if (isForceRetryError(error)) {
						errorReason = error.code;
						// BeforeRetry can still modify the custom request
						return new Request(request, {
							headers: {
								...Object.fromEntries(request.headers),
								'X-Retry': 'from-beforeRetry',
							},
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.true(beforeRetryWasCalled);
	t.true(errorWasForceRetryError);
	t.is(errorReason, 'HOOK_COMPOSITION_TEST');
	// First request has neither header, second request has both
	t.is(finalHeaders[0], undefined); // X-Custom from first request
	t.is(finalHeaders[1], undefined); // X-Retry from first request
	t.is(finalHeaders[2], 'from-afterResponse'); // X-Custom from second request
	t.is(finalHeaders[3], 'from-beforeRetry'); // X-Retry from second request
});

test('afterResponse hook custom request respects retry limit', async t => {
	let attemptCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		attemptCount++;
		response.json({error: {code: 'ALWAYS_RETRY'}});
	});

	await t.throwsAsync(
		ky.get(server.url, {
			retry: {limit: 2},
			hooks: {
				afterResponse: [
					async ({request, response}) => {
						const data = await response.clone().json();
						if (data.error?.code === 'ALWAYS_RETRY') {
							// Always force retry with custom request
							return ky.retry({
								request: new Request(request),
								code: 'LIMIT_TEST',
							});
						}
					},
				],
			},
		}),
		{instanceOf: Error},
	);

	t.is(attemptCount, 3); // Initial + 2 retries
});

test('afterResponse hook custom request is observable in beforeRetry', async t => {
	let beforeRetryCallCount = 0;
	let observedError;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		if (beforeRetryCallCount === 0) {
			response.json({error: {code: 'CUSTOM_REQUEST_RETRY'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'CUSTOM_REQUEST_RETRY') {
						return ky.retry({
							request: new Request(request),
							code: 'CUSTOM_REQUEST',
						});
					}
				},
			],
			beforeRetry: [
				({error}) => {
					beforeRetryCallCount++;
					observedError = error;
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(beforeRetryCallCount, 1);
	t.true(isForceRetryError(observedError));
	t.is(observedError.code, 'CUSTOM_REQUEST');
	t.is(observedError.message, 'Forced retry: CUSTOM_REQUEST');
});

test('afterResponse hook can combine custom request with custom delay', async t => {
	let requestCount = 0;
	const startTime = Date.now();
	let retryTime;

	const server = await createHttpTestServer(t);
	server.get('/primary', (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.json({error: {code: 'FALLBACK_WITH_DELAY'}});
		}
	});

	server.get('/backup', (_request, response) => {
		requestCount++;
		retryTime = Date.now();
		response.json({success: true});
	});

	const result = await ky.get(`${server.url}/primary`, {
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'FALLBACK_WITH_DELAY') {
						return ky.retry({
							request: new Request(`${server.url}/backup`, {
								method: request.method,
								headers: request.headers,
							}),
							delay: 100,
							code: 'BACKUP_WITH_DELAY',
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	const elapsedTime = retryTime - startTime;

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2);
	t.true(elapsedTime >= 100); // Should have waited at least 100ms
});

test('afterResponse hook custom request with modified body', async t => {
	const receivedBodies: any[] = [];

	const server = await createHttpTestServer(t);
	server.post('/', async (request, response) => {
		receivedBodies.push(request.body);

		if (receivedBodies.length === 1) {
			response.json({error: {code: 'RETRY_WITH_MODIFIED_BODY'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.post(server.url, {
		json: {original: true},
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'RETRY_WITH_MODIFIED_BODY') {
						return ky.retry({
							request: new Request(request.url, {
								method: request.method,
								headers: request.headers,
								body: JSON.stringify({modified: true}),
							}),
							code: 'MODIFIED_BODY',
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.deepEqual(receivedBodies[0], {original: true});
	t.deepEqual(receivedBodies[1], {modified: true});
});

test('afterResponse hook custom request with timeout configured works correctly', async t => {
	let attemptCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		attemptCount++;
		if (attemptCount === 1) {
			// First request: return error to trigger custom request retry
			response.json({error: {code: 'NEED_FALLBACK'}});
		} else {
			// Second request: custom request should succeed
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		timeout: 1000, // Timeout configured but shouldn't trigger
		retry: {limit: 2},
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'NEED_FALLBACK') {
						// Custom request should inherit proper timeout signal
						return ky.retry({
							request: new Request(request.url, {
								method: request.method,
								headers: request.headers,
							}),
							code: 'CUSTOM_WITH_TIMEOUT',
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(attemptCount, 2);
});

test('afterResponse hook custom request with aborted signal should still work', async t => {
	let attemptCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		attemptCount++;
		if (attemptCount === 1) {
			response.json({error: {code: 'NEED_CUSTOM_REQUEST'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		hooks: {
			afterResponse: [
				async ({request, response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'NEED_CUSTOM_REQUEST') {
						// Create custom request with aborted signal
						const abortController = new AbortController();
						abortController.abort();

						return ky.retry({
							request: new Request(request.url, {
								method: request.method,
								headers: request.headers,
								signal: abortController.signal,
							}),
							code: 'CUSTOM_WITH_ABORT',
						});
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(attemptCount, 2);
});

test('afterResponse hook can force retry with cause parameter', async t => {
	let requestCount = 0;
	let observedCause: Error | undefined;
	const originalError = new Error('Original validation error');

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.json({error: {code: 'NEEDS_VALIDATION'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'NEEDS_VALIDATION') {
						return ky.retry({
							code: 'VALIDATION_ERROR',
							cause: originalError,
						});
					}
				},
			],
			beforeRetry: [
				({error}) => {
					if (isForceRetryError(error)) {
						observedCause = error.cause as Error;
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2);
	t.is(observedCause, originalError);
	t.is(observedCause?.message, 'Original validation error');
});

test('afterResponse hook wraps non-Error cause values in NonError', async t => {
	let requestCount = 0;
	let observedCause: Error | undefined;
	const nonErrorValue = {message: 'Not an Error instance', code: 'CUSTOM'};

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.json({error: {code: 'NEEDS_VALIDATION'}});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					const data = await response.clone().json();
					if (data.error?.code === 'NEEDS_VALIDATION') {
						// JS users (or TS users bypassing types) can pass non-Error values
						return ky.retry({
							code: 'VALIDATION_ERROR',
							cause: nonErrorValue as any, // Simulating runtime type bypass
						});
					}
				},
			],
			beforeRetry: [
				({error}) => {
					if (isForceRetryError(error)) {
						observedCause = error.cause as Error;
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2);
	// Verify cause was wrapped in NonError
	t.is(observedCause?.name, 'NonError');
	t.true(observedCause instanceof Error);
	// Verify original value is accessible via NonError.value
	t.deepEqual((observedCause as any).value, nonErrorValue);
});

test('afterResponse hook can retry on 401 status', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 1) {
			response.status(401).json({error: 'Unauthorized'});
		} else {
			response.json({success: true});
		}
	});

	const result = await ky.get(server.url, {
		retry: {
			limit: 2,
		},
		hooks: {
			afterResponse: [
				async ({response}) => {
					if (response.status === 401) {
						return ky.retry();
					}
				},
			],
		},
	}).json<{success?: boolean}>();

	t.deepEqual(result, {success: true});
	t.is(requestCount, 2); // Initial 401 + 1 retry
});

test('afterResponse hook can refresh token on 401 and retry once', async t => {
	let requestCount = 0;
	let refreshCount = 0;
	let validToken = 'valid-token';

	const server = await createHttpTestServer(t);

	server.post('/auth/refresh', (_request, response) => {
		refreshCount++;
		validToken = `fresh-token-${refreshCount}`;
		response.json({token: validToken});
	});

	server.get('/protected', (request, response) => {
		requestCount++;
		const authHeader = request.headers.authorization;

		if (authHeader === `Bearer ${validToken}`) {
			response.json({success: true});
		} else {
			response.status(401).json({error: 'Unauthorized'});
		}
	});

	const api = ky.extend({
		hooks: {
			afterResponse: [
				async ({request, response, retryCount}) => {
					if (response.status === 401 && retryCount === 0) {
						const {token} = await ky.post(`${server.url}/auth/refresh`).json<{token: string}>();

						const headers = new Headers(request.headers);
						headers.set('Authorization', `Bearer ${token}`);

						return ky.retry({
							request: new Request(request, {headers}),
							code: 'TOKEN_REFRESHED',
						});
					}
				},
			],
		},
	});

	const result = await api.get(`${server.url}/protected`, {
		headers: {
			Authorization: 'Bearer expired-token',
		},
		retry: {
			limit: 2,
		},
	}).json<{success: boolean}>();

	t.is(requestCount, 2);
	t.is(refreshCount, 1);
	t.deepEqual(result, {success: true});
});

test('afterResponse hook prevents infinite token refresh loop', async t => {
	let requestCount = 0;
	let refreshCount = 0;

	const server = await createHttpTestServer(t);

	server.post('/auth/refresh', (_request, response) => {
		refreshCount++;
		response.json({token: `invalid-${refreshCount}`});
	});

	server.get('/protected', (_request, response) => {
		requestCount++;
		response.status(401).json({error: 'Unauthorized'});
	});

	const api = ky.extend({
		hooks: {
			afterResponse: [
				async ({request, response, retryCount}) => {
					if (response.status === 401 && retryCount === 0) {
						const {token} = await ky.post(`${server.url}/auth/refresh`).json<{token: string}>();

						const headers = new Headers(request.headers);
						headers.set('Authorization', `Bearer ${token}`);

						return ky.retry({
							request: new Request(request, {headers}),
							code: 'TOKEN_REFRESHED',
						});
					}
				},
			],
		},
	});

	await t.throwsAsync(
		api.get(`${server.url}/protected`, {
			headers: {
				Authorization: 'Bearer expired-token',
			},
			retry: {
				limit: 2,
			},
		}),
		{
			instanceOf: HTTPError,
			message: /401/,
		},
	);

	t.is(requestCount, 2);
	t.is(refreshCount, 1);
});

test('afterResponse hook handles refresh endpoint failure', async t => {
	let requestCount = 0;
	let refreshCount = 0;

	const server = await createHttpTestServer(t);

	server.post('/auth/refresh', (_request, response) => {
		refreshCount++;
		response.status(500).json({error: 'Internal server error'});
	});

	server.get('/protected', (_request, response) => {
		requestCount++;
		response.status(401).json({error: 'Unauthorized'});
	});

	const api = ky.extend({
		hooks: {
			afterResponse: [
				async ({request, response, retryCount}) => {
					if (response.status === 401 && retryCount === 0) {
						const {token} = await ky.post(`${server.url}/auth/refresh`).json<{token: string}>();

						const headers = new Headers(request.headers);
						headers.set('Authorization', `Bearer ${token}`);

						return ky.retry({
							request: new Request(request, {headers}),
							code: 'TOKEN_REFRESHED',
						});
					}
				},
			],
		},
	});

	const error = await t.throwsAsync(
		api.get(`${server.url}/protected`, {
			headers: {
				Authorization: 'Bearer expired-token',
			},
			retry: {
				limit: 2,
			},
		}),
		{
			instanceOf: HTTPError,
		},
	);

	// When refresh fails, the hook throws, then Ky retries normally
	t.regex(error!.message, /401/);
	t.is(requestCount, 2); // Initial + 1 retry after hook failure
	t.is(refreshCount, 1);
});

test('afterResponse hook handles refresh endpoint returning 401', async t => {
	let requestCount = 0;
	let refreshCount = 0;

	const server = await createHttpTestServer(t);

	server.post('/auth/refresh', (_request, response) => {
		refreshCount++;
		response.status(401).json({error: 'Refresh token expired'});
	});

	server.get('/protected', (_request, response) => {
		requestCount++;
		response.status(401).json({error: 'Unauthorized'});
	});

	const api = ky.extend({
		hooks: {
			afterResponse: [
				async ({request, response, retryCount}) => {
					if (response.status === 401 && retryCount === 0) {
						const {token} = await ky.post(`${server.url}/auth/refresh`).json<{token: string}>();

						const headers = new Headers(request.headers);
						headers.set('Authorization', `Bearer ${token}`);

						return ky.retry({
							request: new Request(request, {headers}),
							code: 'TOKEN_REFRESHED',
						});
					}
				},
			],
		},
	});

	await t.throwsAsync(
		api.get(`${server.url}/protected`, {
			headers: {
				Authorization: 'Bearer expired-token',
			},
			retry: {
				limit: 2,
			},
		}),
		{
			instanceOf: HTTPError,
			message: /401/,
		},
	);

	t.is(requestCount, 1);
	t.is(refreshCount, 1);
});
