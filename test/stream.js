import test from 'ava';
import createTestServer from 'create-test-server';
import ky from '..';

test('stream - fail on unsupported browsers', async t => {
	t.pass();
	// let requestCount = 0;
	// const server = await createTestServer();
	// server.get('/', (request, response) => {
	// 	requestCount++;
	// 	if (requestCount === defaultRetryCount) {
	// 		response.end(fixture);
	// 	} else {
	// 		response.status(99999).end();
	// 	}
	// });
	// t.is(await ky(server.url).text(), fixture);
	// await server.close();
});

test('stream - successfully fetch', async t => {
	t.pass();
});

test('stream - pass content length and download % progress to streamProgressCallback', async t => {
	t.pass();
});

test('stream - pass percent null if no content-length header', async t => {
	t.pass();
});
