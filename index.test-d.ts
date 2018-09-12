import {expectType} from 'tsd-check';
import createTestServer from 'create-test-server';
import ky, {Ky, HTTPError, TimeoutError, ResponsePromise} from '.';

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

// Test Ky HTTP methods
requestMethods.map(async(key) => {
	expectType<ResponsePromise>(await ky[key](server.url));
});

expectType<Ky>(ky.extend({}));
expectType<HTTPError>(new HTTPError());
expectType<TimeoutError>(new TimeoutError);
