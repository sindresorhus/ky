import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

// Fetch §5.2 requires the multipart payload and its Content-Type header to share one boundary.
test('replacing a Request input body keeps the multipart boundary consistent', async t => {
	const server = await createHttpTestServer(t);

	let headerBoundary: string | undefined;
	let bodyBoundary: string | undefined;
	server.post('/', (request, response) => {
		headerBoundary = /boundary=([^;]+)/.exec(request.headers['content-type'] ?? '')?.[1];

		let body = '';
		request.on('data', chunk => {
			body += chunk.toString(); // eslint-disable-line @typescript-eslint/restrict-plus-operands
		});

		request.on('end', () => {
			bodyBoundary = /^--([^\r\n]+)/.exec(body)?.[1];
			response.end();
		});
	});

	const request = new Request(server.url, {method: 'POST', body: 'original'});
	const replacement = new FormData();
	replacement.append('field', 'value');

	await ky(request, {
		body: replacement,
		searchParams: {a: '1'},
	});

	t.is(headerBoundary, bodyBoundary, 'Header boundary must match the body boundary');
});
