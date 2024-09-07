import test from 'ava';
import ky, {type Progress} from '../source/index.js';
import {createLargeBlob} from './helpers/create-large-file.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';
import {parseRawBody} from './helpers/parse-body.js';

test('POST JSON with upload progress', async t => {
	const server = await createHttpTestServer({bodyParser: false});
	server.post('/', async (request, response) => {
		response.json(await parseRawBody(request));
	});

	const json = {test: 'test'};
	const data: Progress[] = [];
	const responseJson = await ky
		.post(server.url, {
			json,
			onUploadProgress(progress) {
				data.push(progress);
			},
		})
		.json();

	// Check if we have at least two progress updates
	t.true(data.length >= 2, 'Should have at least two progress updates');

	// Check the first progress update
	t.true(
		data[0].percent >= 0 && data[0].percent < 1,
		'First update should have progress between 0 and 100%',
	);
	t.true(
		data[0].transferredBytes >= 0,
		'First update should have non-negative transferred bytes',
	);

	// Check intermediate updates (if any)
	for (let i = 1; i < data.length - 1; i++) {
		t.true(
			data[i].percent >= data[i - 1].percent,
			`Update ${i} should have higher or equal percent than previous`,
		);
		t.true(
			data[i].transferredBytes >= data[i - 1].transferredBytes,
			`Update ${i} should have more or equal transferred bytes than previous`,
		);
	}

	// Check the last progress update
	const lastUpdate = data.at(-1);
	t.is(lastUpdate.percent, 1, 'Last update should have 100% progress');
	t.true(
		lastUpdate.totalBytes > 0,
		'Last update should have positive total bytes',
	);
	t.is(
		lastUpdate.transferredBytes,
		lastUpdate.totalBytes,
		'Last update should have transferred all bytes',
	);

	await server.close();
});

test('POST FormData with 10MB file upload progress', async t => {
	const server = await createHttpTestServer({bodyParser: false});
	server.post('/', async (request, response) => {
		let totalBytes = 0;
		for await (const chunk of request) {
			totalBytes += chunk.length as number;
		}

		response.json({receivedBytes: totalBytes});
	});

	const largeBlob = createLargeBlob(10); // 10MB Blob
	const formData = new FormData();
	formData.append('file', largeBlob, 'large-file.bin');

	const data: Array<{
		percent: number;
		transferredBytes: number;
		totalBytes: number;
	}> = [];
	const response = await ky
		.post(server.url, {
			body: formData,
			onUploadProgress(progress) {
				data.push(progress);
			},
		})
		.json<{receivedBytes: number}>();

	// Check if we have at least two progress updates
	t.true(data.length >= 2, 'Should have at least two progress updates');

	// Check the first progress update
	t.true(
		data[0].percent >= 0 && data[0].percent < 1,
		'First update should have progress between 0 and 100%',
	);
	t.true(
		data[0].transferredBytes >= 0,
		'First update should have non-negative transferred bytes',
	);

	// Check intermediate updates (if any)
	for (let i = 1; i < data.length - 1; i++) {
		t.true(
			data[i].percent >= data[i - 1].percent,
			`Update ${i} should have higher or equal percent than previous`,
		);
		t.true(
			data[i].transferredBytes >= data[i - 1].transferredBytes,
			`Update ${i} should have more or equal transferred bytes than previous`,
		);
	}

	// Check the last progress update
	const lastUpdate = data.at(-1);
	t.is(lastUpdate.percent, 1, 'Last update should have 100% progress');
	t.true(
		lastUpdate.totalBytes > 0,
		'Last update should have positive total bytes',
	);
	t.is(
		lastUpdate.transferredBytes,
		lastUpdate.totalBytes,
		'Last update should have transferred all bytes',
	);

	await server.close();
});
