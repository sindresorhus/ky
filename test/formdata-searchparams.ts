import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('FormData with searchParams and onUploadProgress', async t => {
	const server = await createHttpTestServer();

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

	await server.close();
});

test('retries with FormData in afterResponse hook maintains correct boundary', async t => {
	const server = await createHttpTestServer();

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

	await server.close();
});
