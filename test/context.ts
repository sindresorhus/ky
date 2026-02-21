import test from 'ava';
import ky from '../source/index.js';
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
						t.deepEqual(error.options.context, context);
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
		prefixUrl: server.url,
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
	let callCount = 0;

	await ky.get(server.url, {
		context,
		retry: {limit: 2},
		hooks: {
			beforeRequest: [
				({options}) => {
					t.deepEqual(options.context, context);
					callCount++;
				},
			],
		},
	}).json();

	t.is(callCount, 3);
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

test('context is shallow merged', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({success: true});
	});

	const baseApi = ky.create({
		prefixUrl: server.url,
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
