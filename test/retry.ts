import test from 'ava';
import ky from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';
import {withPerformance} from './helpers/with-performance.js';

const fixture = 'fixture';
const defaultRetryCount = 2;
const retryAfterOn500 = 2;
const retryAfterOn413 = 2;

test('network error', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end(fixture);
		} else {
			response.status(99_999).end();
		}
	});

	t.is(await ky(server.url).text(), fixture);
	t.is(requestCount, defaultRetryCount + 1);

	await server.close();
});

test('status code 500', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	t.is(await ky(server.url).text(), fixture);
	t.is(requestCount, defaultRetryCount + 1);

	await server.close();
});

test('only on defined status codes', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(400);
		}
	});

	await t.throwsAsync(ky(server.url).text(), {message: /Bad Request/});
	t.is(requestCount, 1);

	await server.close();
});

test('not on POST', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.post('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await t.throwsAsync(ky.post(server.url).text(), {
		message: /Internal Server Error/,
	});
	t.is(requestCount, 1);

	await server.close();
});

test('respect Retry-After: 0 and retry immediately', async t => {
	const retryCount = 4;
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.writeHead(413, {
				'Retry-After': 0,
			});

			response.end('');
		}
	});

	await withPerformance({
		t,
		expectedDuration: 4 + 4 + 4 + 4,
		async test() {
			t.is(await ky(server.url, {
				retry: retryCount,
			}).text(), fixture);
		},
	});

	t.is(requestCount, 5);

	await server.close();
});

test('RateLimit-Reset is treated the same as Retry-After', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end(fixture);
		} else {
			const header = (requestCount < 2) ? 'RateLimit-Reset' : 'Retry-After';
			response.writeHead(429, {
				[header]: 1,
			});

			response.end('');
		}
	});

	await withPerformance({
		t,
		expectedDuration: 1000 + 1000,
		async test() {
			t.is(await ky(server.url).text(), fixture);
		},
	});

	t.is(requestCount, 3);

	await server.close();
});

test('RateLimit-Reset with time since epoch', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end(fixture);
		} else {
			const twoSecondsByDelta = 2;
			const oneSecondByEpoch = (Date.now() / 1000) + 1;
			response.writeHead(429, {
				'RateLimit-Reset': (requestCount < 2) ? twoSecondsByDelta : oneSecondByEpoch,
			});

			response.end('');
		}
	});

	await withPerformance({
		t,
		expectedDuration: 2000 + 1000,
		async test() {
			t.is(await ky(server.url).text(), fixture);
		},
	});

	t.is(requestCount, 3);

	await server.close();
});

test('respect 413 Retry-After', async t => {
	const startTime = Date.now();
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end((Date.now() - startTime).toString());
		} else {
			response.writeHead(413, {
				'Retry-After': retryAfterOn413,
			});
			response.end('');
		}
	});

	const timeElapsedInMs = Number(await ky(server.url).text());
	t.true(timeElapsedInMs >= retryAfterOn413 * 1000);
	t.is(requestCount, retryAfterOn413 + 1);

	await server.close();
});

test('respect 413 Retry-After with timestamp', async t => {
	const startTime = Date.now();
	let requestCount = 0;

	const server = await createHttpTestServer({bodyParser: false});
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount === defaultRetryCount + 1) {
			response.end((Date.now() - startTime).toString());
		} else {
			// @NOTE we need to round up to the next second due to http-date resolution
			const date = new Date(Date.now() + ((retryAfterOn413 + 1) * 1000)).toUTCString();
			response.writeHead(413, {
				'Retry-After': date,
			});
			response.end('');
		}
	});

	const timeElapsedInMs = Number(await ky(server.url).text());
	t.true(timeElapsedInMs >= retryAfterOn413 * 1000);
	t.is(requestCount, retryAfterOn413 + 1);

	await server.close();
});

test('doesn\'t retry on 413 without Retry-After header', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(413);
	});

	await t.throwsAsync(ky(server.url).text(), {message: /Payload Too Large/});
	t.is(requestCount, 1);
	await ky(server.url, {throwHttpErrors: false}).text();
	t.is(requestCount, 2);

	await server.close();
});

test('respect custom `afterStatusCodes` (500) with Retry-After header', async t => {
	const startTime = Date.now();
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end((Date.now() - startTime).toString());
		} else {
			response.writeHead(500, {
				'Retry-After': retryAfterOn500,
			});
			response.end('');
		}
	});

	const timeElapsedInMs = Number(await ky(server.url, {retry: {afterStatusCodes: [500]}}).text());
	t.true(timeElapsedInMs >= retryAfterOn500 * 1000);
	t.is(requestCount, retryAfterOn500 + 1);

	await server.close();
});

test('respect number of retries', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
			},
		}).text(),
		{
			message: /Request Timeout/,
		},
	);
	t.is(requestCount, 4);

	await server.close();
});

test('respect retry methods', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.post('/', (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			method: 'post',
			retry: {
				limit: 3,
				methods: ['get'],
			},
		}).text(),
		{
			message: /Request Timeout/,
		},
	);
	t.is(requestCount, 1);

	requestCount = 0;
	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 2,
				methods: ['get'],
			},
		}).text(),
		{
			message: /Request Timeout/,
		},
	);
	t.is(requestCount, defaultRetryCount + 1);

	await server.close();
});

test('respect maxRetryAfter', async t => {
	const retryCount = 4;
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.writeHead(413, {
				'Retry-After': 1,
			});

			response.end('');
		}
	});

	await withPerformance({
		t,
		expectedDuration: 420 + 420 + 420 + 420,
		async test() {
			t.is(await ky(server.url, {
				retry: {
					limit: retryCount,
					maxRetryAfter: 420,
				},
			}).text(), fixture);
		},
	});

	t.is(requestCount, 5);

	requestCount = 0;

	await withPerformance({
		t,
		expectedDuration: 1000 + 1000 + 1000 + 1000,
		async test() {
			t.is(await ky(server.url, {
				retry: {
					limit: retryCount,
					maxRetryAfter: 2000,
				},
			}).text(), fixture);
		},
	});

	t.is(requestCount, 5);

	await server.close();
});

test('retry - can provide retry as number', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(ky(server.url, {retry: 4}).text(), {
		message: /Request Timeout/,
	});
	t.is(requestCount, 5);

	await server.close();
});

test('doesn\'t retry on 413 with empty statusCodes and methods', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();

	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(413);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 10,
				statusCodes: [],
				methods: [],
			},
		}).text(),
		{
			message: /Payload Too Large/,
		},
	);

	t.is(requestCount, 1);

	await server.close();
});

test('doesn\'t retry on 413 with empty methods', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(413);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 10,
				methods: [],
			},
		}).text(),
		{
			message: /Payload Too Large/,
		},
	);

	t.is(requestCount, 1);

	await server.close();
});

test('does retry on 408 with methods provided as array', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				methods: ['get'],
			},
		}).text(),
		{
			message: /Request Timeout/,
		},
	);

	t.is(requestCount, 4);

	await server.close();
});

test('does retry on 408 with statusCodes provided as array', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				statusCodes: [408],
			},
		}).text(),
		{
			message: /Request Timeout/,
		},
	);

	t.is(requestCount, 4);

	await server.close();
});

test('doesn\'t retry when retry.limit is set to 0', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 0,
			},
		}).text(),
		{
			message: /Request Timeout/,
		},
	);

	t.is(requestCount, 1);

	await server.close();
});

test('throws when retry.methods is not an array', async t => {
	const server = await createHttpTestServer();

	t.throws(() => {
		void ky(server.url, {
			retry: {
				// @ts-expect-error
				methods: 'get',
			},
		});
	});

	await server.close();
});

test('throws when retry.statusCodes is not an array', async t => {
	const server = await createHttpTestServer();

	t.throws(() => {
		void ky(server.url, {
			retry: {
				// @ts-expect-error
				statusCodes: 403,
			},
		});
	});

	await server.close();
});

test('respect maximum backoffLimit', async t => {
	const retryCount = 4;
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await withPerformance({
		t,
		expectedDuration: 300 + 600 + 1200 + 2400,
		async test() {
			t.is(await ky(server.url, {
				retry: retryCount,
			}).text(), fixture);
		},
	});

	t.is(requestCount, 5);

	requestCount = 0;

	await withPerformance({
		t,
		expectedDuration: 300 + 600 + 1000 + 1000,
		async test() {
			t.is(await ky(server.url, {
				retry: {
					limit: retryCount,
					backoffLimit: 1000,
				},
			}).text(), fixture);
		},
	});

	t.is(requestCount, 5);

	await server.close();
});

test('respect custom retry.delay', async t => {
	const retryCount = 4;
	let requestCount = 0;

	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await withPerformance({
		t,
		expectedDuration: 200 + 300 + 400 + 500,
		async test() {
			t.is(await ky(server.url, {
				retry: {
					limit: retryCount,
					delay: n => 100 * (n + 1),
				},
			}).text(), fixture);
		},
	});

	t.is(requestCount, 5);

	await server.close();
});
