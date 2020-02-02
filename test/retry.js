import test from 'ava';
import createTestServer from 'create-test-server';
import ky from '..';

const fixture = 'fixture';
const defaultRetryCount = 2;
const retryAfterOn413 = 2;
const lastTried413access = Date.now();

test('network error', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end(fixture);
		} else {
			response.status(99999).end();
		}
	});

	t.is(await ky(server.url).text(), fixture);

	await server.close();
});

test('status code 500', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	t.is(await ky(server.url).text(), fixture);

	await server.close();
});

test('only on defined status codes', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end(fixture);
		} else {
			response.sendStatus(400);
		}
	});

	await t.throwsAsync(ky(server.url).text(), /Bad Request/);

	await server.close();
});

test('not on POST', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.post('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await t.throwsAsync(ky.post(server.url).text(), /Internal Server Error/);

	await server.close();
});

test('respect 413 Retry-After', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount) {
			response.end((Date.now() - lastTried413access).toString());
		} else {
			response.writeHead(413, {
				'Retry-After': retryAfterOn413
			});
			response.end('');
		}
	});

	const result = await ky(server.url).text();
	t.true(Number(result) >= retryAfterOn413 * 1000);

	await server.close();
});

test('respect 413 Retry-After with timestamp', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;
		if (requestCount === defaultRetryCount) {
			response.end((Date.now() - lastTried413access).toString());
		} else {
			const date = (new Date(Date.now() + (retryAfterOn413 * 1000))).toUTCString();
			response.writeHead(413, {
				'Retry-After': date
			});
			response.end('');
		}
	});

	const result = await ky(server.url).text();
	t.true(Number(result) >= retryAfterOn413 * 1000);
	t.is(requestCount, 2);

	await server.close();
});

test('doesn\'t retry on 413 without Retry-After header', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;
		response.sendStatus(413);
	});

	await t.throwsAsync(ky(server.url).text(), /Payload Too Large/);
	t.is(requestCount, 1);
	await ky(server.url, {throwHttpErrors: false}).text();
	t.is(requestCount, 2);

	await server.close();
});

test('respect number of retries', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3
			}
		}).text(),
		/Request Timeout/
	);
	t.is(requestCount, 3);

	await server.close();
});

test('respect retry methods', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.post('/', (request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	server.get('/', (request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			method: 'post',
			retry: {
				limit: 3,
				methods: ['get']
			}
		}).text(),
		/Request Timeout/
	);
	t.is(requestCount, 1);

	requestCount = 0;
	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				methods: ['get']
			}
		}).text(),
		/Request Timeout/
	);
	t.is(requestCount, 3);

	await server.close();
});

test('respect maxRetryAfter', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', async (request, response) => {
		requestCount++;

		response.writeHead(413, {
			'Retry-After': 1
		});

		response.end('');
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 5,
				maxRetryAfter: 100
			}
		}).text(),
		/Payload Too Large/
	);
	t.is(requestCount, 1);

	requestCount = 0;
	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 5,
				maxRetryAfter: 2000
			}
		}).text(),
		/Payload Too Large/
	);
	t.is(requestCount, 5);

	await server.close();
});

test('retry - can provide retry as number', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', async (request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {retry: 5}).text(),
		/Request Timeout/
	);
	t.is(requestCount, 5);

	await server.close();
});

test('doesn\'t retry on 413 with empty statusCodes and methods', async t => {
	let requestCount = 0;

	const server = await createTestServer();

	server.get('/', async (request, response) => {
		requestCount++;
		response.sendStatus(413);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 10,
				statusCodes: [],
				methods: []
			}
		}).text(),
		/Payload Too Large/
	);

	t.is(requestCount, 1);

	await server.close();
});

test('doesn\'t retry on 413 with empty methods', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', async (request, response) => {
		requestCount++;
		response.sendStatus(413);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 10,
				methods: []
			}
		}).text(),
		/Payload Too Large/
	);

	t.is(requestCount, 1);

	await server.close();
});

test('does retry on 408 with methods provided as array', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', async (request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 4,
				methods: ['get']
			}
		}).text(),
		/Request Timeout/
	);

	t.is(requestCount, 4);

	await server.close();
});

test('does retry on 408 with statusCodes provided as array', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', async (request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 4,
				statusCodes: [408]
			}
		}).text(),
		/Request Timeout/
	);

	t.is(requestCount, 4);

	await server.close();
});

test('doesn\'t retry when retry.limit is set to 0', async t => {
	let requestCount = 0;

	const server = await createTestServer();
	server.get('/', (request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 0
			}
		}).text(),
		/Request Timeout/
	);

	t.is(requestCount, 1);

	await server.close();
});

test('throws when retry.methods is not an array', async t => {
	const server = await createTestServer();

	t.throws(() => {
		ky(server.url, {
			retry: {
				methods: 'get'
			}
		});
	});

	await server.close();
});

test('throws when retry.statusCodes is not an array', async t => {
	const server = await createTestServer();

	t.throws(() => {
		ky(server.url, {
			retry: {
				statusCodes: 403
			}
		});
	});

	await server.close();
});
