import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('FormData with searchParams and onUploadProgress', async t => {
	const server = await createHttpTestServer(t);

	server.post('/', (request, response) => {
		const url = new URL(request.url!, `http://${request.headers.host}`);

		let body = '';
		request.on('data', chunk => {
			body += chunk; // eslint-disable-line @typescript-eslint/restrict-plus-operands
		});

		request.on('end', () => {
			response.json({
				params: Object.fromEntries(url.searchParams),
				bodyLength: body.length,
				contentType: request.headers['content-type'] ?? '',
			});
		});
	});

	const formData = new FormData();
	formData.append('field', 'value');
	formData.append('file', new Blob(['test content'], {type: 'text/plain'}), 'test.txt');

	let wasProgressCalled = false;
	let lastProgress = 0;

	const response = await ky.post(server.url, {
		body: formData,
		searchParams: {
			foo: 'bar',
			test: '123',
		},
		onUploadProgress(progress) {
			wasProgressCalled = true;
			lastProgress = progress.percent;
		},
	}).json<{params: Record<string, string>; bodyLength: number; contentType: string}>();

	// Check that searchParams were added to URL
	t.is(response.params.foo, 'bar');
	t.is(response.params.test, '123');

	// Check that FormData body was sent (should be multipart with content)
	t.true(response.bodyLength > 0, 'Body should not be empty');
	t.true(response.contentType.includes('multipart/form-data'), 'Should have multipart content-type');

	// Check that progress callback was called
	t.true(wasProgressCalled, 'Upload progress callback should have been called');
	t.is(lastProgress, 1, 'Final progress should be 100%');
});

test('retries with FormData in afterResponse hook maintains correct boundary', async t => {
	const server = await createHttpTestServer(t);

	let requestCount = 0;
	const receivedBoundaries: string[] = [];

	server.post('/', (request, response) => {
		requestCount++;

		const contentType = request.headers['content-type'] ?? '';
		const boundaryMatch = /boundary=([^;]+)/.exec(contentType);
		const headerBoundary = boundaryMatch?.[1];

		let body = '';
		request.on('data', chunk => {
			body += chunk.toString(); // eslint-disable-line @typescript-eslint/restrict-plus-operands
		});

		request.on('end', () => {
			// Extract boundary from actual body content
			const bodyBoundaryMatch = /^--([^\r\n]+)/.exec(body);
			const bodyBoundary = bodyBoundaryMatch?.[1];

			receivedBoundaries.push(`header:${headerBoundary},body:${bodyBoundary}`);

			if (requestCount === 1) {
				// First request fails with 401
				response.status(401).end();
			} else {
				// Second request succeeds - verify boundary matches
				const boundariesMatch = headerBoundary === bodyBoundary;
				response.json({success: boundariesMatch});
			}
		});
	});

	const formData = new FormData();
	formData.append('field', 'value');

	const result = await ky.post(server.url, {
		body: formData,
		hooks: {
			afterResponse: [
				async ({request, options, response}) => {
					if (response.status === 401) {
						return ky(request, options);
					}
				},
			],
		},
	}).json<{success: boolean}>();

	t.is(requestCount, 2, 'Should make 2 requests');
	t.true(result.success, 'Content-type boundary should match body boundary on retry');
});

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

// A hook can replace the request body, as in the "Modifying FormData in hooks" example. The body of the replaced request must not be cancelled, because the runtime may still read it to serialize the replacement body.
test('a hook can replace a FormData body', async t => {
	const server = await createHttpTestServer(t);

	let headerBoundary: string | undefined;
	let body = '';
	server.post('/', (request, response) => {
		headerBoundary = /boundary=([^;]+)/.exec(request.headers['content-type'] ?? '')?.[1];

		request.on('data', chunk => {
			body += chunk.toString(); // eslint-disable-line @typescript-eslint/restrict-plus-operands
		});

		request.on('end', () => {
			response.end();
		});
	});

	const formData = new FormData();
	formData.append('Food', 'fries');

	await ky.post(server.url, {
		body: formData,
		hooks: {
			beforeRequest: [({request}) => {
				const replacement = new FormData();
				for (const [key, value] of formData) {
					replacement.set(key.toLowerCase(), value);
				}

				request.headers.delete('content-type');
				return new Request(request, {body: replacement});
			}],
		},
	});

	t.truthy(headerBoundary);
	t.is(`--${headerBoundary}`, body.slice(0, headerBoundary.length + 2), 'Header boundary must match the body boundary');
	t.true(body.includes('name="food"'), 'The replacement fields must be sent');
	t.false(body.includes('name="Food"'), 'The replaced fields must not be sent');
});
