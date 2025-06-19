import type {IncomingHttpHeaders} from 'node:http';
import test from 'ava';
import type {RequestHandler} from 'express';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const echoHeaders: RequestHandler = (request, response) => {
	request.resume();
	response.end(JSON.stringify(request.headers));
};

test('`user-agent`', async t => {
	const server = await createHttpTestServer();
	server.get('/', echoHeaders);

	const headers = await ky.get(server.url, {
		bearer: 'awesome',
	}).json<IncomingHttpHeaders>();
	t.is(headers.authorization, 'Bearer awesome');
});
