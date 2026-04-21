import {Buffer} from 'node:buffer';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import {expectTypeOf} from 'expect-type';
import ky, {
	HTTPError,
	KyError,
	SchemaValidationError,
	TimeoutError,
	isKyError,
	replaceOption,
	type StandardSchemaV1,
} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';
import {parseRawBody} from './helpers/parse-body.js';

const fixture = 'fixture';

type TestSchemaResult<Output> = {value: Output} | {issues: Array<{message: string}>};

const createSchema = <Output>(
	validate: (value: unknown) => TestSchemaResult<Output> | Promise<TestSchemaResult<Output>>,
): StandardSchemaV1<unknown, Output> => ({
	'~standard': {
		version: 1,
		vendor: 'test',
		validate,
	},
});

const isObjectWithValue = (value: unknown): value is {value: unknown} => (
	typeof value === 'object'
	&& value !== null
	&& 'value' in value
);

const createSchemaCallTracker = () => {
	let isSchemaCalled = false;

	return {
		schema: createSchema(() => {
			isSchemaCalled = true;
			return {value: {value: 1}};
		}),
		isSchemaCalled: () => isSchemaCalled,
	};
};

test('ky()', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const {ok} = await ky(server.url);
	t.true(ok);
});

test('GET request', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky(server.url).text(), 'GET');
});

test('POST request', async t => {
	const server = await createHttpTestServer(t);
	server.post('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.post(server.url).text(), 'POST');
});

test('PUT request', async t => {
	const server = await createHttpTestServer(t);
	server.put('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.put(server.url).text(), 'PUT');
});

test('PATCH request', async t => {
	const server = await createHttpTestServer(t);
	server.patch('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.patch(server.url).text(), 'PATCH');
});

test('HEAD request', async t => {
	t.plan(2);

	const server = await createHttpTestServer(t);
	server.head('/', (request, response) => {
		response.end(request.method);
		t.pass();
	});

	t.is(await ky.head(server.url).text(), '');
});

test('DELETE request', async t => {
	const server = await createHttpTestServer(t);
	server.delete('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky.delete(server.url).text(), 'DELETE');
});

test('POST JSON', async t => {
	t.plan(2);

	const server = await createHttpTestServer(t);
	server.post('/', async (request, response) => {
		t.is(request.headers['content-type'], 'application/json');
		response.json(request.body);
	});

	const json = {
		foo: true,
	};

	const responseJson = await ky.post(server.url, {json}).json();

	t.deepEqual(responseJson, json);
});

test('cannot use `body` option with GET or HEAD method', t => {
	t.throws(
		() => {
			void ky.get('https://example.com', {body: 'foobar'});
		},
		{
			message: 'Request with GET/HEAD method cannot have body.',
		},
	);

	t.throws(
		() => {
			void ky.head('https://example.com', {body: 'foobar'});
		},
		{
			message: 'Request with GET/HEAD method cannot have body.',
		},
	);
});

test('cannot use `json` option with GET or HEAD method', t => {
	t.throws(
		() => {
			void ky.get('https://example.com', {json: {}});
		},
		{
			message: 'Request with GET/HEAD method cannot have body.',
		},
	);

	t.throws(
		() => {
			void ky.head('https://example.com', {json: {}});
		},
		{
			message: 'Request with GET/HEAD method cannot have body.',
		},
	);
});

test('`json` option overrides the `body` option', async t => {
	t.plan(2);

	const server = await createHttpTestServer(t);
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
});

test('custom headers', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.headers.unicorn);
	});

	t.is(
		await ky(server.url, {
			headers: {
				unicorn: fixture,
			},
		}).text(),
		fixture,
	);
});

test('JSON with custom Headers instance', async t => {
	t.plan(3);

	const server = await createHttpTestServer(t);
	server.post('/', async (request, response) => {
		t.is(request.headers.unicorn, 'rainbow');
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
});

test('.json() with custom accept header', async t => {
	t.plan(2);

	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		t.is(request.headers.accept, 'foo/bar');
		response.json({});
	});

	const responseJson = await ky(server.url, {
		headers: {accept: 'foo/bar'},
	}).json();

	t.deepEqual(responseJson, {});
});

test('.json() when response is chunked', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		response.write('[');
		response.write('"one",');
		response.write('"two"');
		response.end(']');
	});

	const responseJson = await ky.get<['one', 'two']>(server.url).json();

	expectTypeOf(responseJson).toEqualTypeOf<['one', 'two']>();

	t.deepEqual(responseJson, ['one', 'two']);
});

test('.json() with invalid JSON body', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		t.is(request.headers.accept, 'application/json');
		response.end('not json');
	});

	await t.throwsAsync(ky.get(server.url).json(), {
		message: /Unexpected token/,
	});
});

test('.json() with empty body', async t => {
	t.plan(2);

	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		t.is(request.headers.accept, 'application/json');
		response.end();
	});

	const promise = ky.get<{foo: string}>(server.url).json();
	expectTypeOf(promise).toEqualTypeOf<Promise<{foo: string}>>();

	await t.throwsAsync(promise, {
		message: /Unexpected end of JSON input/,
	});
});

test('.json() with 204 response and empty body', async t => {
	t.plan(2);

	const server = await createHttpTestServer(t);
	server.get('/', async (request, response) => {
		t.is(request.headers.accept, 'application/json');
		response.status(204).end();
	});

	await t.throwsAsync(ky(server.url).json(), {
		message: /Unexpected end of JSON input/,
	});
});

test('.json() with 204 response does not call parseJson', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		response.status(204).end();
	});

	let parseJsonCalled = false;
	await t.throwsAsync(ky(server.url, {
		parseJson() {
			parseJsonCalled = true;
			return undefined;
		},
	}).json(), {
		message: /Unexpected end of JSON input/,
	});

	t.false(parseJsonCalled);
});

test('.json() with empty body does not call parseJson', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		response.end();
	});

	let parseJsonCalled = false;
	await t.throwsAsync(ky(server.url, {
		parseJson() {
			parseJsonCalled = true;
			return undefined;
		},
	}).json(), {
		message: /Unexpected end of JSON input/,
	});

	t.false(parseJsonCalled);
});

test('.json(schema) returns validated output and infers type', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: 1});
	});

	const schema = createSchema<{value: number}>(value => {
		if (
			isObjectWithValue(value)
			&& typeof value.value === 'number'
		) {
			return {value: {value: value.value}};
		}

		return {issues: [{message: 'Expected {value:number}'}]};
	});

	const responseJson = await ky.get(server.url).json(schema);

	expectTypeOf(responseJson).toEqualTypeOf<{value: number}>();
	t.deepEqual(responseJson, {value: 1});
});

test('.json(schema) accepts schema with typed input generic', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json('1');
	});

	const schema: StandardSchemaV1<string, number> = {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate(value) {
				if (typeof value === 'string') {
					return {value: Number(value)};
				}

				return {issues: [{message: 'Expected string'}]};
			},
		},
	};

	const responseJson = await ky.get(server.url).json(schema);

	expectTypeOf(responseJson).toEqualTypeOf<number>();
	t.is(responseJson, 1);
});

test('.json(schema) accepts callable schema objects', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: 1});
	});

	const schema: StandardSchemaV1<unknown, {value: number}> = Object.assign(
		() => undefined,
		{
			'~standard': {
				version: 1 as const,
				vendor: 'test',
				validate(value: unknown) {
					if (
						isObjectWithValue(value)
						&& typeof value.value === 'number'
					) {
						return {value: {value: value.value}};
					}

					return {issues: [{message: 'Expected {value:number}'}]};
				},
			},
		},
	);

	const responseJson = await ky.get(server.url).json(schema);

	t.deepEqual(responseJson, {value: 1});
});

test('.json(schema) throws SchemaValidationError when validation fails', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: 'invalid'});
	});

	const issues = [{message: 'Expected {value:number}'}];
	const schema = createSchema<{value: number}>(() => ({issues}));

	const error = await t.throwsAsync(ky.get(server.url).json(schema), {
		instanceOf: SchemaValidationError,
		message: 'Response schema validation failed',
	});

	t.false(isKyError(error));
	t.deepEqual(error?.issues, issues);
});

test('.json(schema) throws TypeError for invalid schema objects', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: 1});
	});

	const invalidSchema = {'~standard': {}} as unknown as StandardSchemaV1;

	await t.throwsAsync(ky.get(server.url).json(invalidSchema), {
		instanceOf: TypeError,
		message: 'The `schema` argument must follow the Standard Schema specification',
	});
});

test('.json(schema) throws TypeError for null schema values', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: 1});
	});

	const invalidSchema = null as unknown as StandardSchemaV1;

	await t.throwsAsync(ky.get(server.url).json(invalidSchema), {
		instanceOf: TypeError,
		message: 'The `schema` argument must follow the Standard Schema specification',
	});
});

test('isKyError works for branded cross-realm KyError subclasses', t => {
	class CustomKyError extends KyError {
		override name = 'CustomKyError';
	}

	const error = Object.assign(new Error('cross-realm error'), {
		name: 'CustomKyError',
		isKyError: new CustomKyError().isKyError,
	});

	t.true(isKyError(error));
});

test('isKyError does not match unrelated errors named KyError', t => {
	const error = new Error('not from ky');
	error.name = 'KyError';

	t.false(isKyError(error));
});

test('.json(schema) allows schema output transformations', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: '1'});
	});

	const schema = createSchema<{value: number}>(value => {
		if (
			isObjectWithValue(value)
			&& typeof value.value === 'string'
		) {
			return {value: {value: Number(value.value)}};
		}

		return {issues: [{message: 'Expected {value:string}'}]};
	});

	const responseJson = await ky.get(server.url).json(schema);

	t.deepEqual(responseJson, {value: 1});
});

test('.json(schema) supports async validation', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: 1});
	});

	const schema = createSchema<{value: number}>(async value => {
		await delay(1);

		if (
			isObjectWithValue(value)
			&& typeof value.value === 'number'
		) {
			return {value: {value: value.value}};
		}

		return {issues: [{message: 'Expected {value:number}'}]};
	});

	const responseJson = await ky.get(server.url).json(schema);

	t.deepEqual(responseJson, {value: 1});
});

test('.json(schema) validates empty body values as undefined', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const issues = [{message: 'Expected non-empty JSON'}];
	let validatedValue: unknown = Symbol('unset');
	const schema = createSchema<unknown>(value => {
		validatedValue = value;
		return {issues};
	});

	const error = await t.throwsAsync(ky.get(server.url).json(schema), {
		instanceOf: SchemaValidationError,
		message: 'Response schema validation failed',
	});

	t.is(validatedValue, undefined);
	t.deepEqual(error?.issues, issues);
});

test('.json(schema) validates 204 responses as undefined', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(204).end();
	});

	const issues = [{message: 'Expected non-empty JSON'}];
	let validatedValue: unknown = Symbol('unset');
	const schema = createSchema<unknown>(value => {
		validatedValue = value;
		return {issues};
	});

	const error = await t.throwsAsync(ky.get(server.url).json(schema), {
		instanceOf: SchemaValidationError,
		message: 'Response schema validation failed',
	});

	t.is(validatedValue, undefined);
	t.deepEqual(error?.issues, issues);
});

test('.json(schema) with empty body does not call parseJson before validation', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	let parseJsonCalled = false;
	const schema = createSchema<string>(value => ({
		value: value === undefined ? 'empty:undefined' : 'non-empty',
	}));

	const responseJson = await ky.get(server.url, {
		parseJson(text) {
			parseJsonCalled = true;
			return JSON.parse(text);
		},
	}).json(schema);

	t.false(parseJsonCalled);
	t.is(responseJson, 'empty:undefined');
});

test('.json(schema) with 204 response does not call parseJson before validation', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(204).end();
	});

	let parseJsonCalled = false;
	const schema = createSchema<string>(value => ({
		value: value === undefined ? 'empty:undefined' : 'non-empty',
	}));

	const responseJson = await ky.get(server.url, {
		parseJson(text) {
			parseJsonCalled = true;
			return JSON.parse(text);
		},
	}).json(schema);

	t.false(parseJsonCalled);
	t.is(responseJson, 'empty:undefined');
});

test('.json(schema) with invalid JSON body throws parse error before validation', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end('not json');
	});

	const {schema, isSchemaCalled} = createSchemaCallTracker();

	await t.throwsAsync(ky.get(server.url).json(schema), {
		message: /Unexpected token/,
	});

	t.false(isSchemaCalled());
});

test('.json(schema) does not run validation for HTTP errors', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(500).json({value: 1});
	});

	const {schema, isSchemaCalled} = createSchemaCallTracker();

	await t.throwsAsync(ky.get(server.url).json(schema), {
		instanceOf: HTTPError,
	});

	t.false(isSchemaCalled());
});

test('.json(schema) accepts empty body when schema validates it', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const schema = createSchema<string>(value => ({
		value: value === undefined ? 'empty:undefined' : 'non-empty',
	}));

	const responseJson = await ky.get(server.url).json(schema);

	t.is(responseJson, 'empty:undefined');
});

test('.json(schema) runs validation when throwHttpErrors is false', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(500).json({error: 'server error'});
	});

	const schema = createSchema<{error: string}>(value => {
		if (
			typeof value === 'object'
			&& value !== null
			&& 'error' in value
		) {
			return {value: value as {error: string}};
		}

		return {issues: [{message: 'Expected {error:string}'}]};
	});

	const responseJson = await ky.get(server.url, {throwHttpErrors: false}).json(schema);

	t.deepEqual(responseJson, {error: 'server error'});
});

test('.json(schema) propagates errors thrown by validate()', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: 1});
	});

	const schema = createSchema<unknown>(() => {
		throw new Error('validate exploded');
	});

	await t.throwsAsync(ky.get(server.url).json(schema), {
		message: 'validate exploded',
	});
});

test('timeout option', async t => {
	t.plan(2);
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		await delay(2000);
		response.end(fixture);
	});

	await t.throwsAsync(ky(server.url, {timeout: 1000}).text(), {
		instanceOf: TimeoutError,
	});

	t.is(requestCount, 1);
});

test('timeout:false option', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		await delay(1000);
		response.end(fixture);
	});

	await t.notThrowsAsync(ky(server.url, {timeout: false}).text());

	t.is(requestCount, 1);
});

test('invalid timeout option', async t => {
	// #117
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('timeout option is cancelled when the promise is resolved', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.method);
	});

	const start = Date.now();

	await ky(server.url, {timeout: 2000});

	const duration = start - Date.now();

	t.true(duration < 10);
});

test('normalizing retry options does not mutate the caller retry object', async t => {
	const retry = {
		methods: ['GET'],
	};

	await ky('https://example.com', {
		fetch: async () => new Response('ok'),
		retry,
	}).text();

	t.deepEqual(retry, {
		methods: ['GET'],
	});
});

test('searchParams option', async t => {
	const server = await createHttpTestServer(t);

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
});

test('searchParams option with undefined values', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url.slice(1));
	});

	const objectWithUndefined = {
		cats: 'meow',
		dogs: undefined,
		opossums: 'false',
		birds: undefined,
	};

	const objectWithNull = {
		cats: 'meow',
		dogs: null as any,
		opossums: 'false',
	};

	// Undefined values should be filtered out
	t.is(await ky(server.url, {searchParams: objectWithUndefined}).text(), '?cats=meow&opossums=false');

	// Null values should be preserved as string "null"
	t.is(await ky(server.url, {searchParams: objectWithNull}).text(), '?cats=meow&dogs=null&opossums=false');
});

test('merges searchParams with input URL', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const response = await ky(`${server.url}?foo=1`, {
		searchParams: {bar: '2'},
	});

	const url = await response.text();
	t.true(url.includes('foo=1'), `URL should contain foo=1, got: ${url}`);
	t.true(url.includes('bar=2'), `URL should contain bar=2, got: ${url}`);
});

test('searchParams with undefined deletes input URL searchParams', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const response = await ky(`${server.url}?foo=1&bar=2&qux=3`, {
		// @ts-expect-error - we test that explicitly undefined value is handled
		searchParams: {foo: undefined, baz: '3', qux: 'undefined'},
	});

	const url = await response.text();
	t.false(url.includes('foo=1'), `URL should not contain foo=1, got: ${url}`);
	t.true(url.includes('bar=2'), `URL should contain bar=2, got: ${url}`);
	t.true(url.includes('baz=3'), `URL should contain baz=3, got: ${url}`);
	t.true(url.includes('qux=undefined'), `URL should contain qux=undefined, got: ${url}`);
});

test('merges searchParams with explicitly undefined deep options', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: new URLSearchParams({a: '1', b: '2'})});
	const response = await api.get(`${server.url}?z=0`, {
		// @ts-expect-error - testing undefined value
		searchParams: {b: undefined, c: '3'},
	});

	const url = await response.text();
	t.true(url.includes('z=0'), `URL should contain z=0, got: ${url}`);
	t.true(url.includes('a=1'), `URL should contain a=1, got: ${url}`);
	t.false(url.includes('b=2'), `URL should not contain b=2, got: ${url}`);
	t.true(url.includes('c=3'), `URL should contain c=3, got: ${url}`);
});

test('merges plain object searchParams with URLSearchParams', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const client = ky.create({searchParams: {api: '123'}});
	const response = await client.get(server.url, {
		searchParams: new URLSearchParams({_limit_: '1'}),
	});

	const url = await response.text();
	t.true(url.includes('api=123'), `URL should contain api=123, got: ${url}`);
	t.true(url.includes('_limit_=1'), `URL should contain _limit_=1, got: ${url}`);
	t.false(url.includes('[object Object]'), `URL should not contain [object Object], got: ${url}`);
	t.false(url.includes('headers'), `URL should not contain 'headers', got: ${url}`);
});

test('merges URLSearchParams with plain object searchParams', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const client = ky.create({searchParams: new URLSearchParams({api: '123'})});
	const response = await client.get(server.url, {
		searchParams: {_limit_: '1'},
	});

	const url = await response.text();
	t.true(url.includes('api=123'), `URL should contain api=123, got: ${url}`);
	t.true(url.includes('_limit_=1'), `URL should contain _limit_=1, got: ${url}`);
	t.false(url.includes('[object Object]'), `URL should not contain [object Object], got: ${url}`);
});

test('merges URLSearchParams with URLSearchParams', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const client = ky.create({searchParams: new URLSearchParams({api: '123'})});
	const response = await client.get(server.url, {
		searchParams: new URLSearchParams({_limit_: '1'}),
	});

	const url = await response.text();
	t.true(url.includes('api=123'), `URL should contain api=123, got: ${url}`);
	t.true(url.includes('_limit_=1'), `URL should contain _limit_=1, got: ${url}`);
	t.false(url.includes('[object Object]'), `URL should not contain [object Object], got: ${url}`);
});

test('merges searchParams with duplicate keys', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const client = ky.create({searchParams: new URLSearchParams({filter: 'active'})});
	const response = await client.get(server.url, {
		searchParams: new URLSearchParams({filter: 'recent', _limit_: '10'}),
	});

	const urlString = await response.text();
	const url = new URL(urlString, server.url);
	const filterValues = url.searchParams.getAll('filter');

	t.deepEqual(filterValues.sort(), ['active', 'recent'], `Both filter values should be present, got: ${JSON.stringify(filterValues)}`);
	t.is(url.searchParams.get('_limit_'), '10', `URL should contain _limit_=10, got: ${urlString}`);
	t.false(urlString.includes('[object Object]'), `URL should not contain [object Object], got: ${urlString}`);
});

test('deletes merged search params even when all additions are removed by undefined', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: {foo: '1', bar: '2'}});
	const response = await api.get(`${server.url}?foo=from-url&bar=from-url&keep=1`, {
		// @ts-expect-error - testing undefined value
		searchParams: {foo: undefined, bar: undefined},
	});

	const url = new URL(await response.text(), server.url);
	t.false(url.searchParams.has('foo'));
	t.false(url.searchParams.has('bar'));
	t.is(url.searchParams.get('keep'), '1');
});

test('request searchParams undefined removes merged keys but keeps unrelated values', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.extend({searchParams: {foo: '1', bar: '2'}}).extend({searchParams: {baz: '3'}});

	const response = await api.get(`${server.url}?bar=from-url&keep=1`, {
		// @ts-expect-error - testing undefined value
		searchParams: {foo: undefined, extra: '4'},
	});

	const url = new URL(await response.text(), server.url);
	t.false(url.searchParams.has('foo'));
	t.is(url.searchParams.get('baz'), '3');
	t.is(url.searchParams.get('bar'), 'from-url');
	t.is(url.searchParams.get('extra'), '4');
	t.is(url.searchParams.get('keep'), '1');
});

test('string searchParams merge keeps duplicates across input URL and defaults', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: new URLSearchParams({filter: 'active'})});
	const response = await api.get(`${server.url}?filter=old&sort=old`, {
		searchParams: 'filter=recent&sort=new',
	});

	const url = new URL(await response.text(), server.url);
	t.deepEqual(url.searchParams.getAll('filter').sort(), ['active', 'old', 'recent']);
	t.deepEqual(url.searchParams.getAll('sort').sort(), ['new', 'old']);
});

test('init hook can delete merged search params via undefined', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({
		searchParams: {foo: '1', bar: '2'},
		hooks: {
			init: [
				options => {
					// @ts-expect-error - testing undefined value
					options.searchParams = {foo: undefined, baz: '3'};
				},
			],
		},
	});

	const response = await api.get(`${server.url}?bar=from-url`);
	const url = new URL(await response.text(), server.url);

	t.false(url.searchParams.has('foo'));
	t.is(url.searchParams.get('bar'), 'from-url'); // Input URL overrides instance default
	t.is(url.searchParams.get('baz'), '3'); // Added by init hook
});

test('ky.extend() searchParams layer deletion propagates through merged instances', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.extend({searchParams: {foo: '1'}})
		.extend({searchParams: {bar: '2'}});
	const response = await api.get(`${server.url}?bar=from-url`, {
		// @ts-expect-error - testing undefined value
		searchParams: {foo: undefined},
	});

	const url = new URL(await response.text(), server.url);
	t.false(url.searchParams.has('foo'));
	t.is(url.searchParams.get('bar'), 'from-url');
});

test('searchParams option merges with existing query when hash is present', async t => {
	const customFetch: typeof fetch = async input => {
		if (!(input instanceof Request)) {
			throw new TypeError('Expected to have input as request');
		}

		return new Response(input.url);
	};

	const url = 'https://example.com/unicorn';

	t.is(
		await ky(url + '?old#hash', {
			fetch: customFetch,
			searchParams: {foo: '1'},
		}).text(),
		url + '?old=&foo=1#hash',
	);
});

test('init hook deletion over merged defaults and input URL', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.extend({searchParams: {foo: '1'}});
	const response = await api.get(`${server.url}?foo=from-url`, {
		hooks: {
			init: [
				options => {
					options.searchParams = {foo: undefined};
				},
			],
		},
	});

	const url = new URL(await response.text(), server.url);
	t.false(url.searchParams.has('foo'));
});

test('init hook preserves merged URLSearchParams deletions', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: new URLSearchParams({foo: '1'})}).extend({
		searchParams: {foo: undefined},
		hooks: {
			init: [
				() => {}, // eslint-disable-line @typescript-eslint/no-empty-function
			],
		},
	});

	const response = await api.get(`${server.url}?foo=from-url&bar=2`);
	const url = new URL(await response.text(), server.url);

	t.false(url.searchParams.has('foo'));
	t.is(url.searchParams.get('bar'), '2');
});

test('init hook preserves merged plain object deletions', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: {foo: '1'}}).extend({
		searchParams: {foo: undefined},
		hooks: {
			init: [
				() => {}, // eslint-disable-line @typescript-eslint/no-empty-function
			],
		},
	});

	const response = await api.get(`${server.url}?foo=from-url&bar=2`);
	const url = new URL(await response.text(), server.url);

	t.false(url.searchParams.has('foo'));
	t.is(url.searchParams.get('bar'), '2');
});

test('init hook can re-add deleted URLSearchParams keys in place', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: new URLSearchParams({foo: '1'})}).extend({
		searchParams: {foo: undefined},
		hooks: {
			init: [
				options => {
					(options.searchParams as URLSearchParams).append('foo', '2');
				},
			],
		},
	});

	const response = await api.get(`${server.url}?foo=from-url&bar=2`);
	const url = new URL(await response.text(), server.url);

	t.deepEqual(url.searchParams.getAll('foo'), ['2']);
	t.is(url.searchParams.get('bar'), '2');
});

test('re-adding a key after an earlier deletion across merge layers', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: {foo: '1'}}).extend({
		searchParams: {foo: undefined},
	});

	const response = await api.get(server.url, {
		searchParams: {foo: '2'},
	});

	const url = new URL(await response.text(), server.url);
	t.is(url.searchParams.get('foo'), '2');
});

test('deletion from a replaceOption(...) boundary', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: {foo: '1', bar: '2'}}).extend({
		searchParams: replaceOption({bar: undefined, baz: '3'}),
	});

	const response = await api.get(server.url);

	const url = new URL(await response.text(), server.url);
	t.false(url.searchParams.has('foo'));
	t.false(url.searchParams.has('bar'));
	t.is(url.searchParams.get('baz'), '3');
});

test('duplicate-key deletion with URLSearchParams', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const response = await ky.get(`${server.url}?foo=1&foo=2&bar=3`, {
		searchParams: {foo: undefined},
	});

	const url = new URL(await response.text(), server.url);
	t.false(url.searchParams.has('foo'));
	t.is(url.searchParams.get('bar'), '3');
});

test('empty merged URLSearchParams plus deletion plus later append', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: new URLSearchParams({foo: '1'})});
	const response = await api.get(server.url, {
		searchParams: {foo: undefined, bar: '2'},
	});

	const url = new URL(await response.text(), server.url);
	t.false(url.searchParams.has('foo'));
	t.is(url.searchParams.get('bar'), '2');
});

test('function-form .extend() with deletion', async t => {
	const server = await createHttpTestServer(t);

	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const api = ky.create({searchParams: {foo: '1'}}).extend(() => ({
		searchParams: {foo: undefined, bar: '2'},
	}));

	const response = await api.get(server.url);

	const url = new URL(await response.text(), server.url);
	t.false(url.searchParams.has('foo'));
	t.is(url.searchParams.get('bar'), '2');
});

test('throwHttpErrors option', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.sendStatus(500);
	});

	await t.notThrowsAsync(ky.get(server.url, {throwHttpErrors: false}).text());
});

test('throwHttpErrors option with POST', async t => {
	const server = await createHttpTestServer(t);
	server.post('/', (_request, response) => {
		response.sendStatus(500);
	});

	await t.notThrowsAsync(ky.post(server.url, {throwHttpErrors: false}).text());
});

test('throwHttpErrors:false does not suppress timeout errors', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('throwHttpErrors function - selective error handling', async t => {
	const server = await createHttpTestServer(t);

	server.get('/404', (_request, response) => {
		response.sendStatus(404);
	});

	server.get('/500', (_request, response) => {
		response.sendStatus(500);
	});

	// Don't throw on 404
	const response404 = await ky.get(`${server.url}/404`, {
		throwHttpErrors: status => status !== 404,
	});
	t.is(response404.status, 404);

	// Throw on 500
	await t.throwsAsync(
		ky.get(`${server.url}/500`, {
			throwHttpErrors: status => status !== 404,
		}).text(),
		{instanceOf: HTTPError},
	);
});

test('does not throw for opaque responses from no-cors requests', async t => {
	const response = await ky('https://example.com', {
		async fetch() {
			const response = new Response(null);
			Object.defineProperty(response, 'type', {value: 'opaque'});
			Object.defineProperty(response, 'ok', {value: false});
			Object.defineProperty(response, 'status', {value: 0});
			Object.defineProperty(response, 'statusText', {value: ''});
			return response;
		},
	});

	t.is(response.status, 0);
});

test('does not throw for opaque responses even when throwHttpErrors is a function', async t => {
	const response = await ky('https://example.com', {
		throwHttpErrors: () => true,
		async fetch() {
			const response = new Response(null);
			Object.defineProperty(response, 'type', {value: 'opaque'});
			Object.defineProperty(response, 'ok', {value: false});
			Object.defineProperty(response, 'status', {value: 0});
			Object.defineProperty(response, 'statusText', {value: ''});
			return response;
		},
	});

	t.is(response.status, 0);
});

test('still throws for opaqueredirect responses', async t => {
	await t.throwsAsync(
		ky('https://example.com', {
			async fetch() {
				const response = new Response(null);
				Object.defineProperty(response, 'type', {value: 'opaqueredirect'});
				Object.defineProperty(response, 'ok', {value: false});
				Object.defineProperty(response, 'status', {value: 0});
				Object.defineProperty(response, 'statusText', {value: ''});
				return response;
			},
		}).text(),
		{instanceOf: HTTPError},
	);
});

test('ky.create()', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(`${request.headers.unicorn} - ${request.headers.rainbow}`);
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
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	let isOriginBeforeRequestTrigged = false;
	let isExtendBeforeRequestTrigged = false;
	let isExtendAfterResponseTrigged = false;

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
			afterResponse: [
				() => {
					isExtendAfterResponseTrigged = true;
				},
			],
		},
	});

	t.is(isOriginBeforeRequestTrigged, true);
	t.is(isExtendBeforeRequestTrigged, true);
	t.is(isExtendAfterResponseTrigged, true);

	const {ok} = await extended.head(server.url);
	t.true(ok);
});

test('ky.create() does not mangle search params', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const instance = ky.create({searchParams: {}});
	t.is(await instance.get(server.url, {searchParams: {}}).text(), '/');
});

test('ky.create() with default json does not add context to merged json body', async t => {
	const server = await createHttpTestServer(t);
	server.post('/', async (request, response) => {
		response.json(request.body);
	});

	const api = ky.create({
		baseUrl: server.url,
		json: {
			foo: 'bar',
		},
	});

	const result = await api.post('', {
		json: {
			baz: 'baz',
		},
	}).json<Record<string, unknown>>();

	t.deepEqual(result, {foo: 'bar', baz: 'baz'});
	t.false('context' in result);
});

const extendHooksMacro = test.macro<[{useFunction: boolean}]>(async (t, {useFunction}) => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	let isOriginBeforeRequestTrigged = false;
	let isOriginAfterResponseTrigged = false;
	let isExtendBeforeRequestTrigged = false;

	const intermediateOptions = {
		hooks: {
			beforeRequest: [
				() => {
					isOriginBeforeRequestTrigged = true;
				},
			],
			afterResponse: [
				() => {
					isOriginAfterResponseTrigged = true;
				},
			],
		},
	};
	const extendedOptions = {
		hooks: {
			beforeRequest: [
				() => {
					isExtendBeforeRequestTrigged = true;
				},
			],
		},
	};

	const extended = ky
		.extend(useFunction ? () => intermediateOptions : intermediateOptions)
		.extend(useFunction ? () => extendedOptions : extendedOptions);

	await extended(server.url);

	t.is(isOriginBeforeRequestTrigged, true);
	t.is(isOriginAfterResponseTrigged, true);
	t.is(isExtendBeforeRequestTrigged, true);

	const {ok} = await extended.head(server.url);
	t.true(ok);
});

test('ky.extend() appends hooks', extendHooksMacro, {useFunction: false});

test('ky.extend() with function appends hooks', extendHooksMacro, {useFunction: false});

test('ky.extend() with function overrides primitives in parent defaults', async t => {
	const server = await createHttpTestServer(t);
	server.use((request, response) => {
		response.end(request.url);
	});

	const api = ky.create({prefix: `${server.url}/api`});
	const usersApi = api.extend(options => ({prefix: `${options.prefix!.toString()}/users`}));

	t.is(await usersApi.get('123').text(), '/api/users/123');
	t.is(await api.get('version').text(), '/api/version');

	{
		const {ok} = await api.head(server.url);
		t.true(ok);
	}

	{
		const {ok} = await usersApi.head(server.url);
		t.true(ok);
	}
});

test('ky.extend() with function retains parent defaults when not specified', async t => {
	const server = await createHttpTestServer(t);
	server.use((request, response) => {
		response.end(request.url);
	});

	const api = ky.create({baseUrl: `${server.url}/api/`});
	const extendedApi = api.extend(() => ({}));

	t.is(await api.get('version').text(), '/api/version');
	t.is(await extendedApi.get('something').text(), '/api/something');

	{
		const {ok} = await api.head(server.url);
		t.true(ok);
	}

	{
		const {ok} = await extendedApi.head(server.url);
		t.true(ok);
	}
});

test('ky.extend() can remove hooks', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	let isOriginalBeforeRequestTrigged = false;
	let isOriginalAfterResponseTrigged = false;

	const extended = ky
		.extend({
			hooks: {
				beforeRequest: [
					() => {
						isOriginalBeforeRequestTrigged = true;
					},
				],
				afterResponse: [
					() => {
						isOriginalAfterResponseTrigged = true;
					},
				],
			},
		})
		.extend({
			hooks: {
				beforeRequest: undefined,
				afterResponse: [],
			},
		});

	await extended(server.url);

	t.is(isOriginalBeforeRequestTrigged, false);
	t.is(isOriginalAfterResponseTrigged, true);

	const {ok} = await extended.head(server.url);
	t.true(ok);
});

test('ky.extend() with replaceOption replaces hooks instead of appending', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const callOrder: string[] = [];

	const base = ky.create({
		hooks: {
			beforeRequest: [
				() => {
					callOrder.push('base');
				},
			],
		},
	});

	const extended = base.extend({
		hooks: replaceOption({
			beforeRequest: [
				() => {
					callOrder.push('extended');
				},
			],
		}),
	});

	await extended(server.url);

	t.deepEqual(callOrder, ['extended']);
});

test('ky.extend() with replaceOption replaces headers instead of merging', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.json({
			unicorn: request.headers.unicorn ?? null,
			rainbow: request.headers.rainbow ?? null,
		});
	});

	const base = ky.create({
		headers: {unicorn: 'unicorn', rainbow: 'rainbow'},
	});

	const extended = base.extend({
		headers: replaceOption({unicorn: 'new-unicorn'}),
	});

	const json = await extended(server.url).json<Record<string, string | undefined>>();

	t.is(json.unicorn, 'new-unicorn');
	t.is(json.rainbow, null);
});

test('ky.extend() with replaceOption preserves Headers instances', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.json({
			authorization: request.headers.authorization ?? null,
			rainbow: request.headers.rainbow ?? null,
		});
	});

	const base = ky.create({
		headers: {rainbow: 'rainbow'},
	});

	const extended = base.extend({
		headers: replaceOption(new Headers({authorization: 'Bearer token'})),
	});

	const json = await extended(server.url).json<Record<string, string | undefined>>();

	t.is(json.authorization, 'Bearer token');
	t.is(json.rainbow, null);
});

test('ky.extend() with replaceOption replaces searchParams instead of appending', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const base = ky.create({
		searchParams: {a: '1', b: '2'},
	});

	const extended = base.extend({
		searchParams: replaceOption({c: '3'}),
	});

	const text = await extended(server.url).text();

	t.true(text.includes('c=3'));
	t.false(text.includes('a=1'));
	t.false(text.includes('b=2'));
});

test('ky.extend() with replaceOption preserves searchParams input forms', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.end(request.url);
	});

	const base = ky.create({
		searchParams: {base: '1'},
	});

	const fromUrlSearchParameters = base.extend({
		searchParams: replaceOption(new URLSearchParams('a=1')),
	});
	const fromString = base.extend({
		searchParams: replaceOption('b=2'),
	});
	const fromTuples = base.extend({
		searchParams: replaceOption([['c', '3']]),
	});

	t.is(await fromUrlSearchParameters(server.url).text(), '/?a=1');
	t.is(await fromString(server.url).text(), '/?b=2');
	t.is(await fromTuples(server.url).text(), '/?c=3');
});

test('ky.extend() with replaceOption works with function form', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const callOrder: string[] = [];

	const base = ky.create({
		hooks: {
			beforeRequest: [
				() => {
					callOrder.push('base');
				},
			],
		},
	});

	const extended = base.extend(() => ({
		hooks: replaceOption({
			beforeRequest: [
				() => {
					callOrder.push('extended');
				},
			],
		}),
	}));

	await extended(server.url);

	t.deepEqual(callOrder, ['extended']);
});

test('ky.extend() with replaceOption followed by normal extend appends correctly', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const callOrder: string[] = [];

	const base = ky.create({
		hooks: {
			beforeRequest: [
				() => {
					callOrder.push('base');
				},
			],
		},
	});

	const replaced = base.extend({
		hooks: replaceOption({
			beforeRequest: [
				() => {
					callOrder.push('replaced');
				},
			],
		}),
	});

	const extended = replaced.extend({
		hooks: {
			beforeRequest: [
				() => {
					callOrder.push('appended');
				},
			],
		},
	});

	await extended(server.url);

	t.deepEqual(callOrder, ['replaced', 'appended']);
});

test('ky.extend() with replaceOption discards all parent hook types', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const callOrder: string[] = [];

	const base = ky.create({
		hooks: {
			beforeRequest: [
				() => {
					callOrder.push('beforeRequest');
				},
			],
			afterResponse: [
				() => {
					callOrder.push('afterResponse');
				},
			],
		},
	});

	// Replace hooks with only beforeRequest — afterResponse from parent should be gone
	const extended = base.extend({
		hooks: replaceOption({
			beforeRequest: [
				() => {
					callOrder.push('replaced');
				},
			],
		}),
	});

	await extended(server.url);

	t.deepEqual(callOrder, ['replaced']);
});

test('ky.extend() with consecutive replaceOption calls each fully replace', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const callOrder: string[] = [];

	const base = ky.create({
		hooks: {
			beforeRequest: [
				() => {
					callOrder.push('base');
				},
			],
		},
	});

	const first = base.extend({
		hooks: replaceOption({
			beforeRequest: [
				() => {
					callOrder.push('first');
				},
			],
		}),
	});

	const second = first.extend({
		hooks: replaceOption({
			beforeRequest: [
				() => {
					callOrder.push('second');
				},
			],
		}),
	});

	await second(server.url);

	t.deepEqual(callOrder, ['second']);
});

test('ky.extend() with replaceOption on headers followed by normal extend merges correctly', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.json({
			unicorn: request.headers.unicorn ?? null,
			rainbow: request.headers.rainbow ?? null,
			star: request.headers.star ?? null,
		});
	});

	const base = ky.create({
		headers: {unicorn: 'unicorn', rainbow: 'rainbow'},
	});

	const replaced = base.extend({
		headers: replaceOption({star: 'star'}),
	});

	// Normal extend after replace should merge with the replaced set
	const extended = replaced.extend({
		headers: {unicorn: 'new-unicorn'},
	});

	const json = await extended(server.url).json<Record<string, string | undefined>>();

	t.is(json.unicorn, 'new-unicorn');
	t.is(json.rainbow, null);
	t.is(json.star, 'star');
});

test('ky.extend() with replaceOption({}) clears headers', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.json({
			unicorn: request.headers.unicorn ?? null,
		});
	});

	const base = ky.create({
		headers: {unicorn: 'unicorn'},
	});

	const extended = base.extend({
		headers: replaceOption({}),
	});

	const json = await extended(server.url).json<Record<string, string | undefined>>();

	t.is(json.unicorn, null);
});

test('ky.extend() with replaceOption on multiple options at once', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (request, response) => {
		response.json({
			unicorn: request.headers.unicorn ?? null,
			url: request.url,
		});
	});

	const callOrder: string[] = [];

	const base = ky.create({
		headers: {unicorn: 'unicorn'},
		searchParams: {a: '1'},
		hooks: {
			beforeRequest: [
				() => {
					callOrder.push('base');
				},
			],
		},
	});

	const extended = base.extend({
		headers: replaceOption({accept: 'text/plain'}),
		searchParams: replaceOption({b: '2'}),
		hooks: replaceOption({
			beforeRequest: [
				() => {
					callOrder.push('extended');
				},
			],
		}),
	});

	const json = await extended(server.url).json<Record<string, string | undefined>>();

	t.is(json.unicorn, null);
	t.true(json.url!.includes('b=2'));
	t.false(json.url!.includes('a=1'));
	t.deepEqual(callOrder, ['extended']);
});

test('ky.extend() with replaceOption replaces context instead of merging', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	let capturedContext: Record<string, unknown> | undefined;

	const base = ky.create({
		context: {a: 1, b: 2},
		hooks: {
			beforeRequest: [
				({options}) => {
					capturedContext = options.context;
				},
			],
		},
	});

	const extended = base.extend({
		context: replaceOption({c: 3}),
	});

	await extended(server.url);

	t.deepEqual(capturedContext, {c: 3});
});

test('ky.extend() with replaceOption({}) clears hooks', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	const callOrder: string[] = [];

	const base = ky.create({
		hooks: {
			beforeRequest: [
				() => {
					callOrder.push('base');
				},
			],
		},
	});

	const extended = base.extend({
		hooks: replaceOption({}),
	});

	await extended(server.url);

	t.deepEqual(callOrder, []);
});

test('ky.extend() with replaceOption replaces retry instead of merging', async t => {
	const server = await createHttpTestServer(t);
	let requestCount = 0;
	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(500);
	});

	const base = ky.create({
		retry: {limit: 3, delay: () => 1},
	});

	const extended = base.extend({
		retry: replaceOption({limit: 0}),
	});

	await t.throwsAsync(extended(server.url));

	t.is(requestCount, 1);
});

test('throws DOMException/Error with name AbortError when aborted by user', async t => {
	const server = await createHttpTestServer(t);
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	server.get('/', () => {});

	const abortController = new AbortController();
	const {signal} = abortController;
	const response = ky(server.url, {signal});
	abortController.abort();

	const error = (await t.throwsAsync(response))!;

	t.true(['DOMException', 'Error'].includes(error.constructor.name), `Expected DOMException or Error, got ${error.constructor.name}`);
	t.is(error.name, 'AbortError', `Expected AbortError, got ${error.name}`);
});

test('throws AbortError when signal was aborted before request', async t => {
	const server = await createHttpTestServer(t);
	let requestCount = 0;
	server.get('/', () => {
		requestCount += 1;
	});

	const abortController = new AbortController();
	const {signal} = abortController;
	const request = new Request(server.url, {signal});
	abortController.abort();
	const response = ky(request);

	const error = (await t.throwsAsync(response))!;

	t.true(['DOMException', 'Error'].includes(error.constructor.name), `Expected DOMException or Error, got ${error.constructor.name}`);
	t.is(error.name, 'AbortError', `Expected AbortError, got ${error.name}`);
	t.is(requestCount, 0, 'Request count is more than 0, server received request.');
});

test('throws AbortError when aborted via Request', async t => {
	const server = await createHttpTestServer(t);
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	server.get('/', () => {});

	const abortController = new AbortController();
	const {signal} = abortController;
	const request = new Request(server.url, {signal});
	const response = ky(request);
	abortController.abort();

	const error = (await t.throwsAsync(response))!;

	t.true(['DOMException', 'Error'].includes(error.constructor.name), `Expected DOMException or Error, got ${error.constructor.name}`);
	t.is(error.name, 'AbortError', `Expected AbortError, got ${error.name}`);
});

test('merges signals from instance and request options', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		await delay(100);
		response.end('success');
	});

	const instanceController = new AbortController();
	const requestController = new AbortController();

	const instance = ky.create({
		signal: instanceController.signal,
	});

	const response = instance.get(server.url, {
		signal: requestController.signal,
	});

	requestController.abort();

	const error = (await t.throwsAsync(response))!;
	t.true(['DOMException', 'Error'].includes(error.constructor.name));
	t.is(error.name, 'AbortError');
});

test('supports Request instance as input', async t => {
	const server = await createHttpTestServer(t);
	const inputRequest = new Request(server.url, {method: 'POST'});

	server.post('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky(inputRequest).text(), inputRequest.method);
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
	const server = await createHttpTestServer(t);
	const inputRequest = new Request(server.url, {method: 'GET'});

	server.post('/', (request, response) => {
		response.end(request.method);
	});

	t.is(await ky(inputRequest, {method: 'POST'}).text(), 'POST');
});

test('options override Request instance body', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});

	const requestBody = JSON.stringify({test: true});
	const expectedBody = JSON.stringify({test: false});

	const inputRequest = new Request(server.url, {
		method: 'POST',
		body: requestBody,
	});

	server.post('/', (request, response) => {
		// eslint-disable-next-line @typescript-eslint/no-restricted-types
		const body: Buffer[] = [];

		// eslint-disable-next-line @typescript-eslint/no-restricted-types
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
});

test('POST JSON with falsy value', async t => {
	// #222
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		response.json(await parseRawBody(request));
	});

	const json = false;
	const responseJson = await ky.post(server.url, {json}).json();

	t.deepEqual(responseJson, json.toString());
});

test('parseJson option with response.json()', async t => {
	const json = {hello: 'world'};

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		response.json(json);
	});

	const response = await ky.get(server.url, {
		parseJson: text => ({
			...JSON.parse(text),
			extra: 'extraValue',
		}),
	});

	const responseJson = await response.json<{hello: string; extra: string}>();

	expectTypeOf(responseJson).toEqualTypeOf({hello: 'world', extra: 'extraValue'});

	t.deepEqual(responseJson, {
		...json,
		extra: 'extraValue',
	});
});

test('parseJson option with response.json() does not run on empty body', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.end();
	});

	let parseJsonCalled = false;
	const response = await ky.get(server.url, {
		parseJson() {
			parseJsonCalled = true;
			return undefined;
		},
	});

	await t.throwsAsync(response.json(), {
		message: /Unexpected end of JSON input/,
	});

	t.false(parseJsonCalled);
});

test('parseJson option with promise.json() shortcut', async t => {
	const json = {hello: 'world'};

	const server = await createHttpTestServer(t);
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
});

test('parseJson option runs before .json(schema) validation', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: '1'});
	});

	const schema = createSchema<{value: number}>(value => {
		if (
			isObjectWithValue(value)
			&& typeof value.value === 'number'
		) {
			return {value: {value: value.value}};
		}

		return {issues: [{message: 'Expected parsed number'}]};
	});

	const responseJson = await ky
		.get(server.url, {
			parseJson(text) {
				const parsed = JSON.parse(text) as {value: string};
				return {value: Number(parsed.value)};
			},
		})
		.json(schema);

	t.deepEqual(responseJson, {value: 1});
});

test('parseJson option errors are thrown before .json(schema) validation', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json({value: '1'});
	});

	const {schema, isSchemaCalled} = createSchemaCallTracker();

	await t.throwsAsync(
		ky
			.get(server.url, {
				parseJson() {
					throw new Error('parseJson failed');
				},
			})
			.json(schema),
		{
			message: 'parseJson failed',
		},
	);

	t.false(isSchemaCalled());
});

test('parseJson option receives context via .json() shortcut', async t => {
	const json = {hello: 'world'};

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json(json);
	});

	const responseJson = await ky
		.get(server.url, {
			parseJson(text, {request, response}) {
				t.true(request instanceof Request);
				t.true(response instanceof Response);
				t.is(response.status, 200);
				t.true(request.url.includes(server.url));
				return JSON.parse(text);
			},
		})
		.json();

	t.deepEqual(responseJson, json);
});

test('parseJson option receives context via response.json()', async t => {
	const json = {hello: 'world'};

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.json(json);
	});

	const response = await ky.get(server.url, {
		parseJson(text, {request, response}) {
			t.true(request instanceof Request);
			t.true(response instanceof Response);
			t.is(response.status, 200);
			t.true(request.url.includes(server.url));
			return JSON.parse(text);
		},
	});

	const responseJson = await response.json();
	t.deepEqual(responseJson, json);
});

test('parseJson option receives context after retry', async t => {
	const fetchRequests: Request[] = [];
	const parseJsonRequests: Request[] = [];
	let requestCount = 0;
	const statuses: number[] = [];

	const responseJson = await ky
		.get('https://example.com', {
			async fetch(request) {
				fetchRequests.push(request);
				requestCount++;

				if (requestCount === 1) {
					return new Response('{"error":"fail"}', {
						status: 500,
						headers: {'content-type': 'application/json'},
					});
				}

				return new Response('{"hello":"world"}', {
					headers: {'content-type': 'application/json'},
				});
			},
			retry: 1,
			parseJson(text, {request, response}) {
				t.true(request instanceof Request);
				t.true(response instanceof Response);
				t.true(request.url.includes('example.com'));
				parseJsonRequests.push(request);
				statuses.push(response.status);
				return JSON.parse(text);
			},
		})
		.json();

	t.deepEqual(responseJson, {hello: 'world'});
	t.is(requestCount, 2);
	t.not(parseJsonRequests[0], parseJsonRequests[1]);
	t.is(parseJsonRequests[0], fetchRequests[0]);
	t.is(parseJsonRequests[1], fetchRequests[1]);
	// ParseJson is called for the error response (HTTPError#data) and the success response
	t.deepEqual(statuses, [500, 200]);
});

test('stringifyJson option with request.json()', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});

	const json = {hello: 'world'};
	const extra = 'extraValue';

	server.post('/', async (request, response) => {
		const body = await parseRawBody(request);
		t.is(body, JSON.stringify({data: json, extra}));
		response.end();
	});

	await ky.post(server.url, {
		stringifyJson: data => JSON.stringify({data, extra}),
		json,
	});
});
