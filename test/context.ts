import test from 'ava';
import ky, {isHTTPError} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('context is available in all hooks', async t => {
	t.plan(4);

	const server = await createHttpTestServer(t);
	let requestCount = 0;
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.sendStatus(500);
		} else {
			response.json({success: true});
		}
	});

	const context = {id: '123'};

	await t.throwsAsync(
		ky.get(server.url, {
			context,
			retry: {limit: 0},
			hooks: {
				beforeRequest: [
					({options}) => {
						t.deepEqual(options.context, context);
					},
				],
				afterResponse: [
					async ({options}) => {
						t.deepEqual(options.context, context);
					},
				],
				beforeError: [
					({error}) => {
						if (isHTTPError(error)) {
							t.deepEqual(error.options.context, context);
						}

						return error;
					},
				],
			},
		}).json(),
	);

	// Test beforeRetry hook
	await ky.get(server.url, {
		context,
		retry: {limit: 1},
		hooks: {
			beforeRetry: [
				async ({options}) => {
					t.deepEqual(options.context, context);
				},
			],
		},
	}).json();
});

test('context works with ky.create and ky.extend', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({success: true});
	});

	const baseApi = ky.create({
		baseUrl: server.url,
		context: {base: 'value'},
	});

	await baseApi.get('', {
		hooks: {
			beforeRequest: [
				({options}) => {
					t.deepEqual(options.context, {base: 'value'});
				},
			],
		},
	}).json();

	const extendedApi = baseApi.extend({context: {extended: 'value'}});
	await extendedApi.get('', {
		context: {request: 'value'},
		hooks: {
			beforeRequest: [
				({options}) => {
					t.deepEqual(options.context, {base: 'value', extended: 'value', request: 'value'});
				},
			],
		},
	}).json();
});

test('context is preserved across retries', async t => {
	const server = await createHttpTestServer(t);
	let requestCount = 0;
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount <= 2) {
			response.sendStatus(500);
		} else {
			response.json({success: true});
		}
	});

	const context = {id: 'session'};
	let beforeRequestCallCount = 0;
	let beforeRetryCallCount = 0;

	await ky.get(server.url, {
		context,
		retry: {limit: 2},
		hooks: {
			beforeRequest: [
				({options}) => {
					t.deepEqual(options.context, context);
					beforeRequestCallCount++;
				},
			],
			beforeRetry: [
				({options}) => {
					t.deepEqual(options.context, context);
					beforeRetryCallCount++;
				},
			],
		},
	}).json();

	t.is(beforeRequestCallCount, 1);
	t.is(beforeRetryCallCount, 2);
});

test('context defaults to empty object when not provided', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({success: true});
	});

	await ky.get(server.url, {
		hooks: {
			beforeRequest: [({options}) => t.deepEqual(options.context, {})],
		},
	}).json();
});

test('context defaults to empty object in init hooks', async t => {
	const seenContexts: unknown[] = [];
	const options = {
		fetch: async () => new Response('ok'),
	};

	await ky('https://example.com', {
		...options,
		hooks: {
			init: [
				options => {
					seenContexts.push(options.context);
					// The readme promises an object, so hooks can add to it without checks.
					options.context!['fromInit'] = true;
				},
			],
			beforeRequest: [
				({options}) => {
					seenContexts.push(options.context);
				},
			],
		},
	});

	t.deepEqual(seenContexts, [{fromInit: true}, {fromInit: true}]);

	// Also when the init hook comes from an extended instance and the request passes no context.
	seenContexts.length = 0;
	await ky.extend({
		hooks: {
			init: [
				options => {
					seenContexts.push(options.context);
				},
			],
		},
	})('https://example.com', options);
	t.deepEqual(seenContexts, [{}]);

	// A provided context is passed through unchanged.
	seenContexts.length = 0;
	await ky('https://example.com', {
		...options,
		context: {id: 1},
		hooks: {
			init: [
				options => {
					seenContexts.push(options.context);
				},
			],
		},
	});
	t.deepEqual(seenContexts, [{id: 1}]);
});

test('context is shallow merged', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({success: true});
	});

	const baseApi = ky.create({
		baseUrl: server.url,
		context: {
			auth: {apiKey: 'base', userId: 'user-123'},
			settings: {timeout: 5000},
		},
	});

	const extendedApi = baseApi.extend({
		context: {
			auth: {apiKey: 'extended'},
			settings: {retries: 3},
			newField: 'added',
		},
	});

	await extendedApi.get('', {
		hooks: {
			beforeRequest: [
				({options}) => {
					const context = options.context as any;
					t.is(context.auth.apiKey, 'extended');
					t.is(context.auth.userId, undefined);
					t.is(context.settings.timeout, undefined);
					t.is(context.settings.retries, 3);
					t.is(context.newField, 'added');
				},
			],
		},
	}).json();
});

for (const withInitHook of [false, true]) {
	test(`context preserves symbol-keyed metadata with init hook ${withInitHook}`, async t => {
		const metadataKey = Symbol('metadata');
		const context = {label: 'request', [metadataKey]: {traceId: 'trace-123'}};
		let beforeRequestCalls = 0;
		let initCalls = 0;
		const response = await ky('https://example.com', {
			context,
			hooks: {
				init: withInitHook
					? [options => {
						initCalls++;
						t.deepEqual(options.context, context);
					}]
					: [],
				beforeRequest: [({options}) => {
					beforeRequestCalls++;
					t.deepEqual(options.context, context);
				}],
			},
			fetch: async () => new Response('ok'),
		}).text();

		t.is(response, 'ok');
		t.is(initCalls, withInitHook ? 1 : 0);
		t.is(beforeRequestCalls, 1);
	});
}

test('init hook mutations to symbol-keyed context stay isolated between requests', async t => {
	const metadataKey = Symbol('metadata');
	const metadata = {attempt: 0};
	const context = {[metadataKey]: metadata};
	let initCalls = 0;
	let beforeRequestCalls = 0;
	const api = ky.create({
		context,
		hooks: {
			init: [options => {
				initCalls++;
				const clonedMetadata = Reflect.get(options.context, metadataKey) as typeof metadata;
				t.not(clonedMetadata, metadata);
				t.deepEqual(clonedMetadata, {attempt: 0});
				clonedMetadata.attempt++;
			}],
			beforeRequest: [({options}) => {
				beforeRequestCalls++;
				t.deepEqual(options.context, {[metadataKey]: {attempt: 1}});
			}],
		},
		fetch: async () => new Response('ok'),
	});

	t.is(await api('https://example.com').text(), 'ok');
	t.is(await api('https://example.com').text(), 'ok');
	t.deepEqual(metadata, {attempt: 0});
	t.is(initCalls, 2);
	t.is(beforeRequestCalls, 2);
});
