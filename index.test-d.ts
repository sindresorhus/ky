import {expectType} from 'tsd-check';
import createTestServer from 'create-test-server';
import ky, {Ky, HTTPError, TimeoutError, IPromise} from '.';

(async () => {
	const server = await createTestServer();
	server.get('/', (request, response) => {
		response.end();
	});

	server.get('/timeout', (request, response) => {
		setTimeout(() => response.end(), 11000);
	});

	// test ky
	expectType<IPromise>(ky(server.url, {}));

	const requestMethods = [
		'get',
		'post',
		'put',
		'patch',
		'head',
		'delete'
	];

	// test ky http methods
	requestMethods.map(async(key) => {
		expectType<IPromise>(await ky[key](server.url));
	});

	// test ky extend
	expectType<Ky>(ky.extend({}));

	// test ky error
	expectType<HTTPError>(new HTTPError());
	expectType<TimeoutError>(new TimeoutError);
})();
