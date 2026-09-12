import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import ky, {NetworkError} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const fixture = 'https://example.com/unicorn';

test('undefined restores native fetch without changing the parent', async t => {
	const server = await createHttpTestServer(t);
	let requestCount = 0;
	server.get('/', (_request, response) => {
		requestCount++;
		response.end('native fetch');
	});
	const parent = ky.create({fetch: async () => new Response('custom fetch')});
	const child = parent.extend({fetch: undefined});

	t.is(await parent(server.url).text(), 'custom fetch');
	t.is(await child(server.url).text(), 'native fetch');
	t.is(await parent(server.url, {fetch: undefined}).text(), 'native fetch');
	t.is(await parent(server.url).text(), 'custom fetch');
	t.is(requestCount, 2);
});

test('fetch option takes a custom fetch function', async t => {
	t.plan(10);

	const customFetch: typeof fetch = async input => {
		if (!(input instanceof Request)) {
			throw new TypeError('Expected to have input as request');
		}

		return new Response(input.url);
	};

	t.is(await ky(fixture, {fetch: customFetch}).text(), fixture);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: {foo: 'bar'},
		}).text(),
		`${fixture}?foo=bar`,
	);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: {},
		}).text(),
		`${fixture}`,
	);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: [],
		}).text(),
		`${fixture}`,
	);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: new URLSearchParams(),
		}).text(),
		`${fixture}`,
	);
	t.is(
		await ky(fixture, {
			fetch: customFetch,
			searchParams: '  ',
		}).text(),
		`${fixture}`,
	);
	t.is(
		await ky(`${fixture}#hash`, {
			fetch: customFetch,
			searchParams: 'foo',
		}).text(),
		`${fixture}?foo#hash`,
	);
	t.is(
		await ky(`${fixture}?old`, {
			fetch: customFetch,
			searchParams: 'new',
		}).text(),
		`${fixture}?old&new`,
	);
	t.is(
		await ky(`${fixture}?old#hash`, {
			fetch: customFetch,
			searchParams: 'new',
		}).text(),
		`${fixture}?old&new#hash`,
	);
	t.is(await ky('unicorn', {fetch: customFetch, prefix: `${fixture}/api/`}).text(), `${fixture}/api/unicorn`);
});

test('options are correctly passed to Fetch #1', async t => {
	t.plan(1);

	const cache = 'no-store';

	const customFetch: typeof fetch = async request => {
		t.is(request.cache, cache);
		return new Response(request.url);
	};

	await ky(fixture, {cache, fetch: customFetch}).text();
});

for (const searchParameters of [undefined, {page: '2'}]) {
	test(`Request input preserves referrer options${searchParameters ? ' with searchParams' : ''}`, async t => {
		const referrer = 'https://example.com/source';
		const referrerPolicy = 'no-referrer';
		const request = new Request(fixture, {referrer, referrerPolicy});

		const result = await ky(request, {
			searchParams: searchParameters,
			async fetch(request) {
				return Response.json({referrer: request.referrer, referrerPolicy: request.referrerPolicy});
			},
		}).json();

		t.deepEqual(result, {referrer, referrerPolicy});
	});

	test(`Request input allows overriding referrer options${searchParameters ? ' with searchParams' : ''}`, async t => {
		const request = new Request(fixture, {referrer: 'https://example.com/source', referrerPolicy: 'no-referrer'});
		const result = await ky(request, {
			referrer: '',
			referrerPolicy: 'same-origin',
			searchParams: searchParameters,
			async fetch(request) {
				return Response.json({referrer: request.referrer, referrerPolicy: request.referrerPolicy});
			},
		}).json();

		t.deepEqual(result, {referrer: '', referrerPolicy: 'same-origin'});
	});
}

test('options are correctly passed to Fetch #2', async t => {
	const server = await createHttpTestServer(t);

	server.post('/anything', (request, response) => {
		response.json({json: request.body});
	});

	const fixture = {x: true};
	const json = await ky.post(`${server.url}/anything`, {json: fixture}).json();
	t.deepEqual(json.json, fixture);
});

test('post with json does not hang when custom fetch consumes request body', async t => {
	const fixture = {x: true};

	const customFetch: typeof fetch = async request => {
		t.is(request.method, 'POST');
		const parsedBody = await request.json();

		return new Response(JSON.stringify({ok: true, parsedBody}), {
			headers: {
				'content-type': 'application/json',
			},
		});
	};

	const json = await ky.post('https://example.com/endpoint', {
		json: fixture,
		fetch: customFetch,
	}).json();

	t.deepEqual(json, {ok: true, parsedBody: fixture});
});

test('unknown options are passed to fetch', async t => {
	t.plan(1);

	const options = {next: {revalidate: 3600}};

	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.next, options.next);
		return new Response(request.url);
	};

	await ky(fixture, {...options, fetch: customFetch}).text();
});

test('unknown options with falsy values are passed to fetch', async t => {
	t.plan(3);

	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.customNull, null);
		t.is(init.customFalse, false);
		t.is(init.customZero, 0);
		return new Response(request.url);
	};

	await ky(fixture, {
		customNull: null, customFalse: false, customZero: 0, fetch: customFetch,
	}).text();
});

test('ky-specific options are not passed to fetch', async t => {
	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.retry, undefined);
		t.is(init.timeout, undefined);
		t.is(init.hooks, undefined);
		t.is(init.throwHttpErrors, undefined);
		t.is(init.json, undefined);
		return new Response(request.url);
	};

	await ky(fixture, {retry: 3, timeout: 5000, fetch: customFetch}).text();
});

test('fetch-only options like dispatcher are passed to fetch', async t => {
	t.plan(1);

	const mockDispatcher = {name: 'custom-agent'};

	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.dispatcher, mockDispatcher);
		return new Response(request.url);
	};

	await ky(fixture, {dispatcher: mockDispatcher, fetch: customFetch}).text();
});

test('class instance options like dispatcher replace instance defaults instead of being merged into plain objects', async t => {
	t.plan(2);

	class Agent {
		constructor(readonly name: string) {}

		// eslint-disable-next-line @typescript-eslint/no-empty-function
		dispatch() {}
	}

	const defaultAgent = new Agent('default');
	const requestAgent = new Agent('request');

	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.dispatcher, requestAgent);
		t.true(init.dispatcher instanceof Agent);
		return new Response(request.url);
	};

	const api = ky.create({dispatcher: defaultAgent, fetch: customFetch});
	await api(fixture, {dispatcher: requestAgent}).text();
});

test('plain object options replace class instance defaults instead of being merged into them', async t => {
	t.plan(1);

	class Agent {
		constructor(readonly name: string) {}
	}

	const customFetch: typeof fetch = async (request, init) => {
		t.deepEqual(init.dispatcher, {name: 'request'});
		return new Response(request.url);
	};

	const api = ky.create({dispatcher: new Agent('default'), fetch: customFetch});
	await api(fixture, {dispatcher: {name: 'request'}}).text();
});

test.serial('fetch-only options like dispatcher are passed to fetch even when Request is patched', async t => {
	t.plan(1);

	const mockDispatcher = {name: 'custom-agent'};
	const originalDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'dispatcher');

	try {
		Object.defineProperty(Request.prototype, 'dispatcher', {
			value: undefined,
			writable: true,
			enumerable: true,
			configurable: true,
		});

		const customFetch: typeof fetch = async (request, init) => {
			t.is(init.dispatcher, mockDispatcher);
			return new Response(request.url);
		};

		await ky(fixture, {dispatcher: mockDispatcher, fetch: customFetch}).text();
	} finally {
		if (originalDescriptor) {
			Object.defineProperty(Request.prototype, 'dispatcher', originalDescriptor);
		} else {
			delete (Request.prototype as any).dispatcher;
		}
	}
});

test('priority option is passed to fetch', async t => {
	t.plan(1);

	const customFetch: typeof fetch = async (request, init) => {
		t.is(init.priority, 'high');
		return new Response(request.url);
	};

	await ky(fixture, {priority: 'high', fetch: customFetch}).text();
});

test.serial('vendor-specific options like `next` are passed to fetch even when Request is patched', async t => {
	t.plan(1);

	const options = {next: {revalidate: 3600, tags: ['test']}};

	// Simulate Next.js edge runtime behavior by patching Request.prototype
	const originalDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'next');

	try {
		// Patch Request.prototype to have a 'next' property (like Next.js does in edge runtime)
		Object.defineProperty(Request.prototype, 'next', {
			value: undefined,
			writable: true,
			enumerable: true,
			configurable: true,
		});

		const customFetch: typeof fetch = async (request, init) => {
			// Verify that the `next` option is still passed to fetch despite being on Request.prototype
			t.deepEqual(init.next, options.next);
			return new Response(request.url);
		};

		await ky(fixture, {...options, fetch: customFetch}).text();
	} finally {
		// Restore original state
		if (originalDescriptor) {
			Object.defineProperty(Request.prototype, 'next', originalDescriptor);
		} else {
			delete (Request.prototype as any).next;
		}
	}
});

test('a synchronously throwing fetch rejects with that error', async t => {
	const error = new Error('sync boom');

	await t.throwsAsync(ky(fixture, {
		retry: 0,
		fetch() {
			throw error;
		},
	}), {is: error});
});

test('a synchronously throwing fetch rejects with that error when timeout is disabled', async t => {
	const error = new Error('sync boom');

	await t.throwsAsync(ky(fixture, {
		retry: 0,
		timeout: false,
		fetch() {
			throw error;
		},
	}), {is: error});
});

test('a synchronously thrown non-Error value is propagated as-is', async t => {
	const error = await t.throwsAsync<unknown>(ky(fixture, {
		retry: 0,
		fetch() {
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw 'sync boom';
		},
	}) as unknown as Promise<unknown>, {any: true});

	t.is(error, 'sync boom');
});

test('a synchronously thrown network error is wrapped in NetworkError and retried', async t => {
	let requestCount = 0;

	const text = await ky(fixture, {
		retry: {limit: 1, delay: () => 0},
		// Not `async` so the throw stays synchronous.
		// eslint-disable-next-line @typescript-eslint/promise-function-async
		fetch() {
			requestCount++;
			if (requestCount === 1) {
				throw new TypeError('Failed to fetch');
			}

			return Promise.resolve(new Response('ok'));
		},
	}).text();

	t.is(text, 'ok');
	t.is(requestCount, 2);
});

test('a synchronously thrown network error is visible to beforeRetry hooks', async t => {
	let requestCount = 0;
	const retryErrors: Error[] = [];

	await ky(fixture, {
		retry: {limit: 1, delay: () => 0},
		// Not `async` so the throw stays synchronous.
		// eslint-disable-next-line @typescript-eslint/promise-function-async
		fetch() {
			requestCount++;
			if (requestCount === 1) {
				throw new TypeError('Failed to fetch');
			}

			return Promise.resolve(new Response('ok'));
		},
		hooks: {
			beforeRetry: [
				({error}) => {
					retryErrors.push(error);
				},
			],
		},
	}).text();

	t.is(retryErrors.length, 1);
	t.true(retryErrors[0] instanceof NetworkError);
});

test('a synchronously throwing fetch runs beforeError hooks', async t => {
	const error = new Error('sync boom');
	const seenErrors: Error[] = [];

	await t.throwsAsync(ky(fixture, {
		retry: 0,
		fetch() {
			throw error;
		},
		hooks: {
			beforeError: [
				({error}) => {
					seenErrors.push(error);
					return error;
				},
			],
		},
	}), {is: error});

	t.deepEqual(seenErrors, [error]);
});

test('a synchronously throwing fetch does not turn into a TimeoutError when totalTimeout is set', async t => {
	const error = new Error('sync boom');

	await t.throwsAsync(ky(fixture, {
		retry: 0,
		timeout: 50,
		totalTimeout: 1000,
		fetch() {
			throw error;
		},
	}), {is: error});
});

test('the timeout of a synchronously throwing attempt does not abort the retried attempt', async t => {
	let requestCount = 0;
	let retriedRequestSignalAborted: boolean | undefined;

	const text = await ky(fixture, {
		timeout: 100,
		retry: {limit: 1, delay: () => 50},
		// Not `async` so the throw stays synchronous.
		// eslint-disable-next-line @typescript-eslint/promise-function-async
		fetch(request) {
			requestCount++;
			if (requestCount === 1) {
				throw new TypeError('Failed to fetch');
			}

			return (async () => {
				// Resolve after the first attempt's timeout would have fired, but before this attempt's own timeout.
				await delay(80);
				retriedRequestSignalAborted = (request as Request).signal.aborted;
				return new Response('ok');
			})();
		},
	}).text();

	t.is(text, 'ok');
	t.is(requestCount, 2);
	t.false(retriedRequestSignalAborted);
});

test('the timeout of a synchronously throwing attempt does not abort a retried attempt that reads its body late', async t => {
	let requestCount = 0;

	const responsePromise = ky(fixture, {
		timeout: 100,
		retry: {limit: 1, delay: () => 50},
		// Not `async` so the throw stays synchronous.
		// eslint-disable-next-line @typescript-eslint/promise-function-async
		fetch(request) {
			requestCount++;
			if (requestCount === 1) {
				throw new TypeError('Failed to fetch');
			}

			const {signal} = request as Request;
			return Promise.resolve(new Response(new ReadableStream({
				async pull(controller) {
					// Deliver the body after the first attempt's timeout would have fired, but within this attempt's own body read timeout.
					await delay(70);
					if (signal.aborted) {
						controller.error(signal.reason);
						return;
					}

					controller.enqueue(new TextEncoder().encode('ok'));
					controller.close();
				},
			})));
		},
	});

	t.is(await responsePromise.text(), 'ok');
	t.is(requestCount, 2);
});

test('a synchronously throwing retry attempt rejects with that error', async t => {
	let requestCount = 0;
	const error = new Error('sync boom on retry');

	await t.throwsAsync(ky(fixture, {
		retry: {limit: 1, delay: () => 0},
		fetch() {
			requestCount++;
			if (requestCount === 1) {
				throw new TypeError('Failed to fetch');
			}

			throw error;
		},
	}), {is: error});

	t.is(requestCount, 2);
});

test('a fetch that rejects asynchronously does not leave a timer that aborts the retried attempt', async t => {
	let requestCount = 0;
	let retriedRequestSignalAborted: boolean | undefined;

	const text = await ky(fixture, {
		timeout: 100,
		retry: {limit: 1, delay: () => 50},
		async fetch(request) {
			requestCount++;
			if (requestCount === 1) {
				throw new TypeError('Failed to fetch');
			}

			await delay(80);
			retriedRequestSignalAborted = (request as Request).signal.aborted;
			return new Response('ok');
		},
	}).text();

	t.is(text, 'ok');
	t.is(requestCount, 2);
	t.false(retriedRequestSignalAborted);
});

test('the fetch option is called without a `this` value', async t => {
	const thisValues: unknown[] = [];

	const text = await ky(fixture, {
		retry: 0,
		async fetch(this: unknown) {
			thisValues.push(this);
			return new Response('ok');
		},
	}).text();

	t.is(text, 'ok');
	t.deepEqual(thisValues, [undefined]);
});

test('the fetch option is called without a `this` value when timeout is disabled', async t => {
	const thisValues: unknown[] = [];

	const text = await ky(fixture, {
		retry: 0,
		timeout: false,
		async fetch(this: unknown) {
			thisValues.push(this);
			return new Response('ok');
		},
	}).text();

	t.is(text, 'ok');
	t.deepEqual(thisValues, [undefined]);
});

test('the fetch option is called without a `this` value on retries', async t => {
	const thisValues: unknown[] = [];

	const text = await ky(fixture, {
		retry: {limit: 2, delay: () => 0},
		async fetch(this: unknown) {
			thisValues.push(this);
			return new Response(thisValues.length < 3 ? 'error' : 'ok', {status: thisValues.length < 3 ? 500 : 200});
		},
	}).text();

	t.is(text, 'ok');
	t.deepEqual(thisValues, [undefined, undefined, undefined]);
});

test('the fetch option is called without a `this` value on forced retries with a custom request', async t => {
	const thisValues: unknown[] = [];

	const text = await ky(fixture, {
		retry: {limit: 1, delay: () => 0},
		async fetch(this: unknown) {
			thisValues.push(this);
			return new Response('ok');
		},
		hooks: {
			afterResponse: [
				({request}) => {
					if (thisValues.length === 1) {
						return ky.retry({request: new Request(request)});
					}
				},
			],
		},
	}).text();

	t.is(text, 'ok');
	t.deepEqual(thisValues, [undefined, undefined]);
});

test('an unbound global fetch works as the fetch option', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('unicorn');
	});

	t.is(await ky(server.url, {fetch: globalThis.fetch}).text(), 'unicorn');
	t.is(await ky(server.url, {fetch: globalThis.fetch, timeout: false}).text(), 'unicorn');
});

test('an unbound global fetch works as an instance default', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('unicorn');
	});

	const api = ky.create({fetch: globalThis.fetch}).extend({retry: 0});
	t.is(await api(server.url).text(), 'unicorn');
});

test('an unbound global fetch works with a Request input', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('unicorn');
	});

	t.is(await ky(new Request(server.url), {fetch: globalThis.fetch}).text(), 'unicorn');
});

test('an unbound global fetch works when searchParams rebuild the request', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	t.is(await ky(server.url, {fetch: globalThis.fetch, searchParams: {unicorn: 'rainbow'}}).text(), '/?unicorn=rainbow');
});

test('a bound fetch still works as the fetch option', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('unicorn');
	});

	t.is(await ky(server.url, {fetch: globalThis.fetch.bind(globalThis)}).text(), 'unicorn');
});

test('the fetch option inherited through ky.create() and ky.extend() is called without a `this` value', async t => {
	const thisValues: unknown[] = [];

	const api = ky.create({
		async fetch(this: unknown) {
			thisValues.push(this);
			return new Response('ok');
		},
	}).extend({retry: 0});

	t.is(await api(fixture).text(), 'ok');
	t.deepEqual(thisValues, [undefined]);
});
