import {expectType} from 'tsd-check';
import createTestServer from 'create-test-server';
import ky, {Ky, HTTPError, TimeoutError, ResponsePromise, JSONValue} from '.';

const server = await createTestServer();
server.get('/', (request, response) => {
	response.end();
});

server.get('/timeout', (request, response) => {
	setTimeout(() => response.end(), 11000);
});

// Test Ky
expectType<ResponsePromise>(ky(server.url));

const requestMethods = [
	'get',
	'post',
	'put',
	'patch',
	'head',
	'delete'
];

const requestBodyMethods = [
	'post',
	'put',
	'delete'
];

// Test Ky HTTP methods
for (const method of requestMethods) {
	expectType<ResponsePromise>(await ky[method](server.url));
}

// Test Ky HTTP methods with `body`
for (const method of requestBodyMethods) {
	expectType<ResponsePromise>(await ky[method](server.url, {body: 'x'}));
}

expectType<Ky>(ky.extend({}));
expectType<HTTPError>(new HTTPError());
expectType<TimeoutError>(new TimeoutError);

ky(server.url, {
	hooks: {
		beforeRequest: [
			options => {
				expectType<Object>(options);
			}
		],
		afterResponse: [
			response => {
				expectType<Response>(response);
				return new Response('Test');
			}
		]
	}
});

ky(new URL(server.url));
ky(new Request(server.url));

// `searchParams` option
ky(server.url, {searchParams: 'foo=bar'});
ky(server.url, {searchParams: {foo: 'bar'}});
ky(server.url, {searchParams: {foo: 1}});
ky(server.url, {searchParams: new URLSearchParams({foo: 'bar'})});

// `json` option
ky.post(server.url, {
	json: {
		foo: true
	}
});
ky.post(server.url, {
	json: 'x'
});

expectType<JSONValue>(await ky(server.url).json());

interface Result {
	value: number;
}
expectType<Result>(await ky(server.url).json<Result>());
