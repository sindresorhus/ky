import test from 'ava';
import ky, {type Progress} from '../source/index.js';

test('completed download progress uses actual bytes rather than an overestimated content length', async t => {
	const progressEvents: Progress[] = [];
	const text = await ky('https://example.com', {
		fetch: async () => new Response('ok', {headers: {'content-length': '1024'}}),
		onDownloadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(text, 'ok');
	t.deepEqual(progressEvents.at(-1), {
		percent: 1,
		transferredBytes: 2,
		totalBytes: 2,
	});
});

test('completed FormData upload progress uses the actual serialized size', async t => {
	const body = new FormData();
	for (let index = 0; index < 10; index++) {
		body.append(String(index), 'value');
	}

	const progressEvents: Progress[] = [];
	let receivedBytes = 0;
	await ky.post('https://example.com', {
		body,
		retry: 0,
		async fetch(request) {
			const buffer = await request.arrayBuffer();
			receivedBytes = buffer.byteLength;
			return new Response('ok');
		},
		onUploadProgress(progress) {
			progressEvents.push(progress);
		},
	});

	t.true(receivedBytes > 0);
	t.deepEqual(progressEvents.at(-1), {
		percent: 1,
		transferredBytes: receivedBytes,
		totalBytes: receivedBytes,
	});
});

test('completed upload progress uses the actual size of a replaced body', async t => {
	const progressEvents: Progress[] = [];
	const originalBody = 'x'.repeat(1024);
	const replacementBody = 'ok';
	const text = await ky.post('https://example.com', {
		body: originalBody,
		retry: 0,
		hooks: {
			beforeRequest: [({request}) => new Request(request, {body: replacementBody})],
		},
		async fetch(request) {
			return new Response(await request.text());
		},
		onUploadProgress(progress) {
			progressEvents.push(progress);
		},
	}).text();

	t.is(text, replacementBody);
	t.deepEqual(progressEvents.at(-1), {
		percent: 1,
		transferredBytes: 2,
		totalBytes: 2,
	});
});
