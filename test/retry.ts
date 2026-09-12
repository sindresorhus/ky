import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';
import test, {type ExecutionContext} from 'ava';
import LeakDetector from 'jest-leak-detector';
import ky, {
	replaceOption,
	NetworkError,
	TimeoutError,
	isKyError,
	isNetworkError,
} from '../source/index.js';
import {NonError} from '../source/errors/NonError.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';
import {parseRawBody} from './helpers/parse-body.js';
import {withPerformance} from './helpers/with-performance.js';

const fixture = 'fixture';

for (const {title, elapsed, totalTimeout, errorType} of [
	{
		title: 'expired', elapsed: 100, totalTimeout: 50, errorType: TimeoutError,
	},
	{
		title: 'unexpired', elapsed: 25, totalTimeout: 50, errorType: NetworkError,
	},
	{
		title: 'disabled', elapsed: 100, totalTimeout: false, errorType: NetworkError,
	},
] as const) {
	test.serial(`body read failure respects ${title} totalTimeout`, async t => {
		const originalPerformanceNow = globalThis.performance.now;
		let currentTime = 0;
		globalThis.performance.now = () => currentTime;
		t.teardown(() => {
			globalThis.performance.now = originalPerformanceNow;
		});

		let requestCount = 0;
		const hookErrors: Error[] = [];
		const error = await t.throwsAsync(ky('https://example.com', {
			timeout: false,
			totalTimeout,
			async fetch() {
				requestCount++;
				return new Response(new ReadableStream({
					pull(controller) {
						currentTime = elapsed;
						controller.error(new TypeError('terminated'));
					},
				}, {highWaterMark: 0}));
			},
			hooks: {
				beforeError: [({error}) => {
					hookErrors.push(error);
					return error;
				}],
			},
		}).text(), {instanceOf: errorType});

		t.is(error.request.url, 'https://example.com/');
		t.deepEqual(hookErrors, [error]);
		t.is(requestCount, 1);
	});
}

test.serial('totalTimeout takes precedence when fetch rejects after the deadline', async t => {
	const originalPerformanceNow = globalThis.performance.now;
	let currentTime = 0;
	globalThis.performance.now = () => currentTime;
	t.teardown(() => {
		globalThis.performance.now = originalPerformanceNow;
	});

	let requestCount = 0;
	let errorHookCount = 0;
	await t.throwsAsync(ky('https://example.com', {
		timeout: false,
		totalTimeout: 50,
		retry: 0,
		async fetch() {
			requestCount++;
			currentTime = 100;
			throw new TypeError('fetch failed');
		},
		hooks: {
			beforeError: [({error}) => {
				errorHookCount++;
				t.true(error instanceof TimeoutError);
				return error;
			}],
		},
	}), {instanceOf: TimeoutError});
	t.is(requestCount, 1);
	t.is(errorHookCount, 1);

	currentTime = 0;
	await t.throwsAsync(ky('https://example.com', {
		timeout: false,
		totalTimeout: 50,
		retry: 0,
		async fetch() {
			currentTime = 25;
			throw new TypeError('fetch failed');
		},
	}), {instanceOf: NetworkError});

	await t.throwsAsync(ky('https://example.com', {
		timeout: false,
		totalTimeout: false,
		retry: 0,
		async fetch() {
			currentTime = 100;
			throw new TypeError('fetch failed');
		},
	}), {instanceOf: NetworkError});
});

const defaultRetryCount = 2;
const retryAfterOn500 = 2;
const retryAfterOn413 = 2;
const retryAfterTimestampText = '1704067200';
const retryAfterTimestampScheduledDelay = 2_147_483_647;
const httpDateDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const httpDateLongDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const httpDateMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatHttpTime = (date: Date) => [
	date.getUTCHours(),
	date.getUTCMinutes(),
	date.getUTCSeconds(),
].map(value => value.toString().padStart(2, '0')).join(':');

const formatAsctimeDate = (date: Date) => {
	const day = date.getUTCDate().toString().padStart(2, ' ');

	return `${httpDateDayNames[date.getUTCDay()]} ${httpDateMonths[date.getUTCMonth()]} ${day} ${formatHttpTime(date)} ${date.getUTCFullYear()}`;
};

const formatRfc850Date = (date: Date) => {
	const day = date.getUTCDate().toString().padStart(2, '0');
	const year = (date.getUTCFullYear() % 100).toString().padStart(2, '0');

	return `${httpDateLongDayNames[date.getUTCDay()]}, ${day}-${httpDateMonths[date.getUTCMonth()]}-${year} ${formatHttpTime(date)} GMT`;
};

const withCapturedTimeouts = async (body: (scheduledDelays: number[]) => Promise<void>) => {
	const originalSetTimeout = globalThis.setTimeout;
	const scheduledDelays: number[] = [];

	globalThis.setTimeout = ((handler, delayMs, ...arguments_) => {
		if (typeof delayMs === 'number') {
			scheduledDelays.push(delayMs);
		}

		const testDelayMs = typeof delayMs === 'number' && delayMs > 1_000_000 ? 0 : delayMs;
		return originalSetTimeout(handler, testDelayMs, ...arguments_);
	}) as typeof globalThis.setTimeout;

	try {
		await body(scheduledDelays);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}
};

const createSingleRetryHeaderServer = async (t: ExecutionContext, headers: Record<string, string | number>) => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount === 2) {
			response.end(fixture);
			return;
		}

		response.writeHead(429, headers);
		response.end('');
	});

	return {
		server,
		get requestCount() {
			return requestCount;
		},
	};
};

test('undefined resets inherited retry fields without changing the parent', async t => {
	const inheritedRetry = {
		limit: 5,
		methods: ['post'] as const,
		statusCodes: [418],
		afterStatusCodes: [418],
		maxRetryAfter: 10,
		backoffLimit: 10,
		retryOnTimeout: true,
	};
	const parent = ky.create({
		retry: inheritedRetry,
		fetch: async () => new Response(fixture),
	});
	const child = parent.extend({
		retry: {
			limit: undefined,
			methods: undefined,
			statusCodes: undefined,
			afterStatusCodes: undefined,
			maxRetryAfter: undefined,
			backoffLimit: undefined,
			retryOnTimeout: undefined,
		},
	});

	t.is(await child('https://example.com', {
		hooks: {
			beforeRequest: [({options}) => {
				t.like(options.retry, {
					limit: 2,
					methods: ['get', 'put', 'head', 'delete', 'options', 'trace', 'query'],
					statusCodes: [408, 413, 429, 500, 502, 503, 504],
					afterStatusCodes: [413, 429, 503],
					maxRetryAfter: Number.POSITIVE_INFINITY,
					backoffLimit: Number.POSITIVE_INFINITY,
					retryOnTimeout: false,
				});
			}],
		},
	}).text(), fixture);
	t.is(await parent('https://example.com', {
		hooks: {
			beforeRequest: [({options}) => {
				t.like(options.retry, inheritedRetry);
			}],
		},
	}).text(), fixture);
});

test('undefined resets an inherited retry delay without changing the parent', async t => {
	const server = await createHttpTestServer(t);
	let requestCount = 0;
	server.get('/', (_request, response) => {
		requestCount++;
		response.status(requestCount % 2 === 1 ? 503 : 200).end(fixture);
	});
	let customDelayCalls = 0;
	const parent = ky.create({
		retry: {
			backoffLimit: 0,
			delay() {
				customDelayCalls++;
				return 0;
			},
		},
	});
	const child = parent.extend({retry: {delay: undefined}});

	t.is(await child(server.url).text(), fixture);
	t.is(customDelayCalls, 0);
	t.is(await parent(server.url).text(), fixture);
	t.is(customDelayCalls, 1);
	t.is(requestCount, 4);
});

test('network error', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('status code 500', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('only on defined status codes', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('not on POST', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('QUERY retries by default', async t => {
	let requestCount = 0;
	const receivedBodies: unknown[] = [];
	const receivedMethods: string[] = [];

	const server = await createHttpTestServer(t);
	server.all('/', (request, response) => {
		requestCount++;
		receivedMethods.push(request.method);
		receivedBodies.push(request.body);

		if (requestCount === defaultRetryCount + 1) {
			response.json(request.body);
		} else {
			response.sendStatus(500);
		}
	});

	const json = {
		foo: true,
	};

	const result = await ky.query(server.url, {
		json,
		retry: {
			delay: () => 0,
		},
	}).json();

	t.deepEqual(result, json);
	t.is(requestCount, defaultRetryCount + 1);
	t.deepEqual(receivedMethods, ['QUERY', 'QUERY', 'QUERY']);
	t.deepEqual(receivedBodies, [json, json, json]);
});

test('respect Retry-After: 0 and retry immediately', async t => {
	const retryCount = 4;
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test.serial('Retry-After number is treated as delay seconds, not timestamp', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': retryAfterTimestampText,
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(retryAfterTimestampScheduledDelay));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('invalid Retry-After number 0x10 falls back to retry delay', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': '0x10',
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			timeout: false,
			retry: {
				limit: 1,
				delay: () => 10,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(10));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('X-RateLimit-Retry-After number is treated as delay seconds, not timestamp', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'X-RateLimit-Retry-After': retryAfterTimestampText,
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(retryAfterTimestampScheduledDelay));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('Retry-After takes precedence over RateLimit-Reset', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': '1',
		'RateLimit-Reset': retryAfterTimestampText,
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(1000));
		t.false(scheduledDelays.includes(retryAfterTimestampScheduledDelay));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('invalid Retry-After does not fall back to RateLimit-Reset', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': '1e3',
		'RateLimit-Reset': retryAfterTimestampText,
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
				delay: () => 23,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(23));
		t.false(scheduledDelays.includes(retryAfterTimestampScheduledDelay));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('empty Retry-After does not fall back to RateLimit-Reset', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': '',
		'RateLimit-Reset': retryAfterTimestampText,
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
				delay: () => 31,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(31));
		t.false(scheduledDelays.includes(retryAfterTimestampScheduledDelay));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('non-standard Retry-After date falls back to retry delay', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': 'Sun Nov 06 1994 08:49:37 GMT',
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
				delay: () => 29,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(29));
	});

	t.is(retryServer.requestCount, 2);
});

for (const [dateFormat, formatDate] of [
	['RFC 850', formatRfc850Date],
	['asctime', formatAsctimeDate],
] as const) {
	test.serial(`Retry-After supports obsolete HTTP-date format: ${dateFormat}`, async t => {
		const retryAfterDate = formatDate(new Date(Date.now() + 2_000_000));
		const retryServer = await createSingleRetryHeaderServer(t, {
			'Retry-After': retryAfterDate,
		});

		await withCapturedTimeouts(async scheduledDelays => {
			t.is(await ky(retryServer.server.url, {
				retry: {
					limit: 1,
					delay: () => 13,
				},
			}).text(), fixture);

			t.true(scheduledDelays.some(delay => delay > 1_000_000));
			t.false(scheduledDelays.includes(13));
		});

		t.is(retryServer.requestCount, 2);
	});
}

test.serial('Retry-After asctime HTTP-date is parsed as GMT', async t => {
	const retryAfterDate = formatAsctimeDate(new Date(Date.now() + 2_000_000));
	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': retryAfterDate,
	});

	const timeZone = process.env.TZ;
	try {
		process.env.TZ = 'Pacific/Kiritimati';
		await withCapturedTimeouts(async scheduledDelays => {
			t.is(await ky(retryServer.server.url, {
				retry: {
					limit: 1,
					delay: () => 13,
				},
			}).text(), fixture);

			t.true(scheduledDelays.some(delay => delay > 1_000_000));
			t.false(scheduledDelays.includes(13));
		});
	} finally {
		if (timeZone === undefined) {
			delete process.env.TZ;
		} else {
			process.env.TZ = timeZone;
		}
	}

	t.is(retryServer.requestCount, 2);
});

test.serial('Retry-After HTTP-date supports a leap second', async t => {
	const now = Date.now();
	const retryAfterInstant = new Date(now + 2_000_000);
	retryAfterInstant.setUTCSeconds(59, 0);
	const day = retryAfterInstant.getUTCDate().toString().padStart(2, '0');
	const hours = retryAfterInstant.getUTCHours().toString().padStart(2, '0');
	const minutes = retryAfterInstant.getUTCMinutes().toString().padStart(2, '0');
	const dayName = httpDateDayNames[retryAfterInstant.getUTCDay()];
	const month = httpDateMonths[retryAfterInstant.getUTCMonth()];
	const retryAfterDate = `${dayName}, ${day} ${month} ${retryAfterInstant.getUTCFullYear()} ${hours}:${minutes}:60 GMT`;
	const expectedDelay = retryAfterInstant.getTime() + 1000 - now;

	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': retryAfterDate,
	});

	const dateNow = Date.now;
	try {
		Date.now = () => now;
		await withCapturedTimeouts(async scheduledDelays => {
			t.is(await ky(retryServer.server.url, {
				retry: {
					limit: 1,
					delay: () => 13,
				},
			}).text(), fixture);

			t.true(scheduledDelays.includes(expectedDelay));
			t.false(scheduledDelays.includes(expectedDelay - 1000));
			t.false(scheduledDelays.includes(13));
		});
	} finally {
		Date.now = dateNow;
	}

	t.is(retryServer.requestCount, 2);
});

test.serial('Retry-After RFC 850 HTTP-date applies the two-digit year rule', async t => {
	const retryAfterDate = new Date(Date.now() + 2000);
	retryAfterDate.setUTCFullYear(retryAfterDate.getUTCFullYear() + 49);

	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': formatRfc850Date(retryAfterDate),
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
				delay: () => 13,
			},
		}).text(), fixture);

		t.true(scheduledDelays.some(delay => delay > 1_000_000));
		t.false(scheduledDelays.includes(13));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('Retry-After RFC 850 HTTP-date more than 50 years in the future is interpreted as past', async t => {
	const retryAfterDate = new Date(Date.now() + 2000);
	retryAfterDate.setUTCFullYear(retryAfterDate.getUTCFullYear() + 51);

	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': formatRfc850Date(retryAfterDate),
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
				delay: () => 13,
				maxRetryAfter: 1,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(0));
		t.false(scheduledDelays.includes(1));
		t.false(scheduledDelays.includes(13));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('invalid Retry-After HTTP-date components fall back to retry delay', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'Retry-After': 'Sun, 32 Dec 2030 25:99:99 GMT',
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
				delay: () => 17,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(17));
	});

	t.is(retryServer.requestCount, 2);
});

test('RateLimit-Reset delay seconds are respected like Retry-After', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test.serial('RateLimit-Reset with time since epoch', async t => {
	const now = Date.UTC(2026, 0, 1);
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === defaultRetryCount + 1) {
			response.end(fixture);
		} else {
			const oneSecondByDelta = 1;
			const threeSecondsByEpoch = (now / 1000) + 3;
			response.writeHead(429, {
				'RateLimit-Reset': (requestCount < 2) ? oneSecondByDelta : threeSecondsByEpoch,
			});

			response.end('');
		}
	});

	const dateNow = Date.now;
	try {
		Date.now = () => now;
		await withCapturedTimeouts(async scheduledDelays => {
			t.is(await ky(server.url).text(), fixture);

			t.true(scheduledDelays.includes(1000));
			t.true(scheduledDelays.includes(3000));
			t.true(scheduledDelays.indexOf(1000) < scheduledDelays.indexOf(3000));
			t.false(scheduledDelays.includes(retryAfterTimestampScheduledDelay));
		});
	} finally {
		Date.now = dateNow;
	}

	t.is(requestCount, 3);
});

test.serial('empty RateLimit-Reset falls back to retry delay', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'RateLimit-Reset': '',
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
				delay: () => 37,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(37));
	});

	t.is(retryServer.requestCount, 2);
});

test.serial('empty RateLimit-Reset does not fall back to lower-priority reset alias', async t => {
	const retryServer = await createSingleRetryHeaderServer(t, {
		'RateLimit-Reset': '',
		'X-RateLimit-Reset': retryAfterTimestampText,
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(retryServer.server.url, {
			retry: {
				limit: 1,
				delay: () => 41,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(41));
		t.false(scheduledDelays.includes(retryAfterTimestampScheduledDelay));
	});

	t.is(retryServer.requestCount, 2);
});

for (const rateLimitResetHeader of ['X-RateLimit-Reset', 'X-Rate-Limit-Reset']) {
	test.serial(`${rateLimitResetHeader} supports time since epoch`, async t => {
		const now = Date.UTC(2026, 0, 1);
		const retryServer = await createSingleRetryHeaderServer(t, {
			[rateLimitResetHeader]: (now / 1000) + 2,
		});

		const dateNow = Date.now;
		try {
			Date.now = () => now;
			await withCapturedTimeouts(async scheduledDelays => {
				t.is(await ky(retryServer.server.url, {
					retry: {
						limit: 1,
						delay: () => 7,
						maxRetryAfter: 3500,
					},
				}).text(), fixture);

				t.true(scheduledDelays.includes(2000));
				t.false(scheduledDelays.includes(3500));
				t.false(scheduledDelays.includes(7));
			});
		} finally {
			Date.now = dateNow;
		}

		t.is(retryServer.requestCount, 2);
	});
}

test('respect 413 Retry-After', async t => {
	const startTime = Date.now();
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('respect 413 Retry-After with HTTP date', async t => {
	const startTime = Date.now();
	let requestCount = 0;

	const server = await createHttpTestServer(t, {bodyParser: false});
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
});

test('doesn\'t retry on 413 without Retry-After header', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(413);
	});

	await t.throwsAsync(ky(server.url).text(), {message: /Payload Too Large/});
	t.is(requestCount, 1);
	await ky(server.url, {throwHttpErrors: false}).text();
	t.is(requestCount, 2);
});

test('respect custom `afterStatusCodes` (500) with Retry-After header', async t => {
	const startTime = Date.now();
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('custom `afterStatusCodes` does not retry statuses missing from `statusCodes`', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		response.writeHead(400, {
			'Retry-After': 1,
		});
		response.end('');
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				afterStatusCodes: [400],
			},
		}).text(),
		{
			message: /Bad Request/,
		},
	);
	t.is(requestCount, 1);
});

test('respect number of retries', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('rejects invalid retry limits', t => {
	for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
		t.throws(() => {
			void ky('https://example.com', {
				retry: {
					limit,
				},
			});
		}, {
			instanceOf: TypeError,
			message: '`retry.limit` must be a finite, non-negative integer',
		});

		t.throws(() => {
			void ky('https://example.com', {retry: limit});
		}, {
			instanceOf: TypeError,
			message: '`retry.limit` must be a finite, non-negative integer',
		});
	}
});

test('rejects non-number retry limits', t => {
	for (const limit of ['NaN', true, null]) {
		t.throws(() => {
			void ky('https://example.com', {
				retry: {
					limit: limit as never,
				},
			});
		}, {
			instanceOf: TypeError,
			message: '`retry.limit` must be a finite, non-negative integer',
		});
	}
});

test('does not enable retries after sending an uncloned request body', async t => {
	let requestCount = 0;

	await t.throwsAsync(
		ky('https://example.com', {
			method: 'put',
			body: 'body',
			async fetch(input) {
				requestCount++;
				await (input as Request).text();
				return new Response(null, {status: 500});
			},
			retry: {
				limit: 0,
				methods: ['put'],
			},
			hooks: {
				afterResponse: [({options}) => {
					options.retry.limit = 1;
				}],
			},
		}).text(),
		{
			message: /status code 500/,
		},
	);

	t.is(requestCount, 1);
});

test('allows response hooks to disable retries', async t => {
	let requestCount = 0;

	await t.throwsAsync(
		ky('https://example.com', {
			async fetch() {
				requestCount++;
				return new Response(null, {status: 500});
			},
			retry: {
				limit: 1,
				delay: () => 0,
			},
			hooks: {
				afterResponse: [({options}) => {
					options.retry.limit = 0;
				}],
			},
		}).text(),
		{
			message: /status code 500/,
		},
	);

	t.is(requestCount, 1);
});

test('uses the retry limit set by a beforeRequest hook that returns a response', async t => {
	let requestCount = 0;

	const response = await ky('https://example.com', {
		async fetch() {
			requestCount++;
			return new Response('ok');
		},
		retry: {
			limit: 0,
			delay: () => 0,
		},
		hooks: {
			beforeRequest: [({options}) => {
				options.retry.limit = 1;
				return new Response(null, {status: 500});
			}],
			afterResponse: [({response, retryCount}) => {
				if (retryCount === 0 && response.status === 500) {
					return ky.retry();
				}
			}],
		},
	}).text();

	t.is(response, 'ok');
	t.is(requestCount, 1);
});

test('uses the normalized retry limit when cloning request bodies', async t => {
	let requestCount = 0;

	await t.throwsAsync(
		ky('https://example.com', {
			method: 'put',
			body: 'body',
			async fetch(input) {
				requestCount++;
				await (input as Request).text();
				return new Response(null, {status: 500});
			},
			retry: {
				limit: 1,
				methods: ['put'],
				delay: () => 0,
			},
			hooks: {
				init: [options => {
					options.retry = {
						limit: undefined,
						methods: ['put'],
						delay: () => 0,
					};
				}],
			},
		}).text(),
		{
			message: /status code 500/,
		},
	);

	t.is(requestCount, 3);
});

test('rejects invalid retry option values', t => {
	for (const retry of [true, 'NaN', []]) {
		t.throws(() => {
			void ky('https://example.com', {retry: retry as never});
		}, {
			instanceOf: TypeError,
			message: '`retry` must be a number or an object',
		});

		t.throws(() => {
			void ky('https://example.com', {
				retry: retry as never,
				hooks: {
					init: [() => undefined],
				},
			});
		}, {
			instanceOf: TypeError,
			message: '`retry` must be a number or an object',
		});
	}
});

test('init hooks can sanitize retry options before validation', async t => {
	let requestCount = 0;

	await t.throwsAsync(
		ky('https://example.com', {
			async fetch() {
				requestCount++;
				return new Response(null, {status: 500});
			},
			retry: {
				limit: Number.NaN,
			},
			hooks: {
				init: [options => {
					options.retry = 0;
				}],
			},
		}).text(),
	);
	t.is(requestCount, 1);
});

test('respect retry methods', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test.serial('respect maxRetryAfter', async t => {
	let requestCount = 0;
	const customFetch = async () => {
		requestCount++;
		return requestCount === 2
			? new Response(fixture)
			: new Response(null, {
				status: 413,
				headers: {'Retry-After': '2000'},
			});
	};

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky('https://example.com', {
			timeout: false,
			fetch: customFetch,
			retry: {
				limit: 1,
				maxRetryAfter: 1_500_000,
			},
		}).text(), fixture);
		t.is(requestCount, 2);

		requestCount = 0;
		t.is(await ky('https://example.com', {
			timeout: false,
			fetch: customFetch,
			retry: {
				limit: 1,
				maxRetryAfter: 3_000_000,
			},
		}).text(), fixture);
		t.is(requestCount, 2);

		const relevantScheduledDelays = scheduledDelays.filter(delay => delay === 1_500_000 || delay === 2_000_000);
		t.deepEqual(relevantScheduledDelays, [1_500_000, 2_000_000]);
	});
});

test.serial('invalid Retry-After header falls back to retry delay', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.writeHead(429, {
				'Retry-After': 'not-a-valid-value',
			});
			response.end('');
			return;
		}

		response.end(fixture);
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(server.url, {
			timeout: false,
			retry: {
				limit: 1,
				delay: () => 50,
				maxRetryAfter: 10,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(50));
		t.false(scheduledDelays.includes(10));
	});

	t.is(requestCount, 2);
});

test.serial('invalid 413 Retry-After header falls back to retry delay', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.writeHead(413, {
				'Retry-After': 'not-a-valid-value',
			});
			response.end('');
			return;
		}

		response.end(fixture);
	});

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky(server.url, {
			timeout: false,
			retry: {
				limit: 1,
				delay: () => 50,
				maxRetryAfter: 10,
			},
		}).text(), fixture);

		t.true(scheduledDelays.includes(50));
		t.false(scheduledDelays.includes(10));
	});

	t.is(requestCount, 2);
});

test('retry - can provide retry as number', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(ky(server.url, {retry: 4}).text(), {
		message: /Request Timeout/,
	});
	t.is(requestCount, 5);
});

test('retry - extending a numeric `retry` with an object keeps the limit', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	// `retry: 3` is shorthand for `{limit: 3}`. Extending it with an object
	// should preserve that limit instead of falling back to the default.
	const extended = ky.create({retry: 3}).extend({retry: {methods: ['get']}});

	await t.throwsAsync(extended(server.url).text(), {
		message: /Request Timeout/,
	});
	t.is(requestCount, 4);
});

test('retry - extending an object `retry` with a number keeps the other options', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.post('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(500);
	});

	// `retry: 3` is shorthand for `{limit: 3}`, so extending an object with it
	// should only change the limit and keep `methods` and `delay`.
	const extended = ky.create({retry: {methods: ['post'], delay: () => 0}}).extend({retry: 3});

	await t.throwsAsync(extended.post(server.url).text(), {
		message: /Internal Server Error/,
	});
	t.is(requestCount, 4);
});

test('retry - numeric `retry` in per-request options keeps object defaults', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.post('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(500);
	});

	const instance = ky.create({retry: {methods: ['post'], delay: () => 0}});

	await t.throwsAsync(instance.post(server.url, {retry: 1}).text(), {
		message: /Internal Server Error/,
	});
	t.is(requestCount, 2);
});

test('retry - numeric `retry: 0` in per-request options disables retries over object defaults', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.post('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(500);
	});

	const instance = ky.create({retry: {methods: ['post'], delay: () => 0}});

	await t.throwsAsync(instance.post(server.url, {retry: 0}).text(), {
		message: /Internal Server Error/,
	});
	t.is(requestCount, 1);
});

test('retry - number, object, number chain keeps the object options and the last limit', async t => {
	let normalizedRetry: {limit: number; methods: string[]} | undefined;

	const client = ky
		.create({retry: 5})
		.extend({retry: {methods: ['post']}})
		.extend({retry: 1});

	await client.post('https://example.com', {
		async fetch() {
			return new Response('ok');
		},
		hooks: {
			beforeRequest: [
				({options}) => {
					normalizedRetry = {limit: options.retry.limit, methods: options.retry.methods};
				},
			],
		},
	});

	t.deepEqual(normalizedRetry, {limit: 1, methods: ['post']});
});

test('retry - extending an object `retry` with a number keeps custom status codes', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(418);
	});

	const extended = ky.create({retry: {statusCodes: [418], delay: () => 0}}).extend({retry: 2});

	await t.throwsAsync(extended(server.url).text(), {
		message: /I'm a Teapot/,
	});
	t.is(requestCount, 3);
});

test('retry - extending an object `retry` with a number keeps `shouldRetry`', async t => {
	let requestCount = 0;
	let shouldRetryCalls = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(500);
	});

	const extended = ky.create({
		retry: {
			delay: () => 0,
			shouldRetry() {
				shouldRetryCalls++;
				return false;
			},
		},
	}).extend({retry: 3});

	await t.throwsAsync(extended(server.url).text(), {
		message: /Internal Server Error/,
	});
	t.is(requestCount, 1);
	t.is(shouldRetryCalls, 1);
});

test('retry - `replaceOption` with a number replaces the whole object', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.post('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(500);
	});

	// Replacing drops the custom `methods`, so POST falls back to the default non-retriable behavior.
	const extended = ky.create({retry: {methods: ['post'], delay: () => 0}}).extend({retry: replaceOption(3)});

	await t.throwsAsync(extended.post(server.url).text(), {
		message: /Internal Server Error/,
	});
	t.is(requestCount, 1);
});

test('retry - init hook sees a numeric `retry` merged into the object defaults', async t => {
	let initRetry: unknown;

	const client = ky.create({retry: {methods: ['post']}}).extend({retry: 3});

	await client.post('https://example.com', {
		async fetch() {
			return new Response('ok');
		},
		hooks: {
			init: [
				options => {
					initRetry = options.retry;
				},
			],
		},
	});

	t.deepEqual(initRetry, {methods: ['post'], limit: 3});
});

test('retry - invalid numeric `retry` extending an object still throws', t => {
	const client = ky.create({retry: {methods: ['post']}}).extend({retry: -1});

	t.throws(() => {
		void client.post('https://example.com');
	}, {
		instanceOf: TypeError,
		message: '`retry.limit` must be a finite, non-negative integer',
	});
});

test('retry - numeric shorthand over an object does not rewrite nested user data with a `retry` key', async t => {
	const server = await createHttpTestServer(t);
	server.post('/', (request, response) => {
		response.json({body: request.body});
	});

	const client = ky.create({json: {retry: {foo: 'bar'}}}).extend({json: {retry: 3}});

	const {body} = await client.post(server.url).json<{body: {retry: unknown}}>();
	t.is(body.retry, 3);
});

test('retry - shorthand expansion does not rewrite nested user data with a `retry` key', async t => {
	const server = await createHttpTestServer(t);
	server.post('/', (request, response) => {
		response.json({body: request.body});
	});

	// A `retry` key inside the `json` body is user data, not the `retry` option,
	// so the number-to-`{limit}` shorthand must not touch it.
	const client = ky.create({json: {retry: 3}}).extend({json: {retry: {foo: 'bar'}}});

	const {body} = await client.post(server.url).json<{body: {retry: unknown}}>();
	t.deepEqual(body.retry, {foo: 'bar'});
});

test('merging does not rewrite nested user data with a `searchParams` key', async t => {
	let receivedBody: unknown;
	const client = ky.create({json: {searchParams: 'a=1'}}).extend({json: {searchParams: 'b=2'}});

	// A `searchParams` key inside the `json` body is user data, not the `searchParams` option,
	// so option merging must not convert it to `URLSearchParams`.
	await client.post('https://example.com', {
		async fetch(request) {
			receivedBody = await (request as Request).json();
			return new Response('ok');
		},
	});

	t.deepEqual(receivedBody, {searchParams: 'b=2'});
});

test('merging does not rewrite nested user data with a `hooks` key', async t => {
	let receivedBody: unknown;
	const client = ky.create({json: {hooks: ['a']}}).extend({json: {hooks: ['b']}});

	// A `hooks` key inside the `json` body is user data, not the `hooks` option,
	// so option merging must not replace it with a hooks object.
	await client.post('https://example.com', {
		async fetch(request) {
			receivedBody = await (request as Request).json();
			return new Response('ok');
		},
	});

	t.deepEqual(receivedBody, {hooks: ['a', 'b']});
});

test('merging does not rewrite nested user data with a `context` key', async t => {
	let receivedBody: unknown;
	const client = ky.create({json: {context: {a: {x: 1}}}}).extend({json: {context: {a: {y: 2}, b: 3}}});

	// A `context` key inside the `json` body is user data, not the `context` option,
	// so option merging must deep-merge it like any other user data instead of
	// shallow-merging it or rejecting non-object values.
	await client.post('https://example.com', {
		async fetch(request) {
			receivedBody = await (request as Request).json();
			return new Response('ok');
		},
	});

	t.deepEqual(receivedBody, {context: {a: {x: 1, y: 2}, b: 3}});
});

test('merging replaces class instances inside nested user data instead of merging them into plain objects', async t => {
	let receivedBody: unknown;
	const client = ky.create({json: {date: new Date(0)}});

	// A `Date` is not a plain object, so it must be replaced as a whole rather than having its (non-existent) own properties merged into `{}`.
	await client.post('https://example.com', {
		json: {date: new Date(1000)},
		async fetch(request) {
			receivedBody = await (request as Request).json();
			return new Response('ok');
		},
	});

	t.deepEqual(receivedBody, {date: '1970-01-01T00:00:01.000Z'});
});

test('merging replaces class instances inside nested user data when extending', async t => {
	let receivedBody: unknown;
	const client = ky.create({json: {date: new Date(0), keep: true}}).extend({json: {date: new Date(1000)}});

	await client.post('https://example.com', {
		async fetch(request) {
			receivedBody = await (request as Request).json();
			return new Response('ok');
		},
	});

	t.deepEqual(receivedBody, {date: '1970-01-01T00:00:01.000Z', keep: true});
});

test('merging still deep-merges null-prototype objects inside nested user data', async t => {
	let receivedBody: unknown;
	const nested = Object.create(null) as Record<string, unknown>;
	nested.b = 2;
	const client = ky.create({json: {nested: {a: 1}}});

	await client.post('https://example.com', {
		json: {nested},
		async fetch(request) {
			receivedBody = await (request as Request).json();
			return new Response('ok');
		},
	});

	t.deepEqual(receivedBody, {nested: {a: 1, b: 2}});
});

test('merging still concatenates arrays inside nested options', async t => {
	let retryMethods: string[] | undefined;
	const client = ky.create({retry: {methods: ['get']}}).extend({retry: {methods: ['post']}});

	await client('https://example.com', {
		async fetch() {
			return new Response('ok');
		},
		hooks: {
			beforeRequest: [
				({options}) => {
					retryMethods = options.retry.methods;
				},
			],
		},
	});

	t.deepEqual(retryMethods, ['get', 'post']);
});

test('doesn\'t retry on 413 with empty statusCodes and methods', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);

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
});

test('doesn\'t retry on 413 with empty methods', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('does retry on 408 with methods provided as array', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

for (const [method, retryMethod, expectedAttempts] of [
	['REPORT', 'report', 1],
	['report', 'REPORT', 1],
	['REPORT', 'REPORT', 2],
	['report', 'report', 2],
	['GET', 'get', 2],
	['OPTIONS', 'options', 2],
	['PATCH', 'patch', 2],
] as const) {
	test(`retry method matching respects ${method} with ${retryMethod}`, async t => {
		let attempts = 0;

		await t.throwsAsync(ky('https://example.com', {
			method,
			retry: {
				limit: 1,
				methods: [retryMethod],
				delay: () => 0,
			},
			async fetch(request) {
				attempts++;
				t.is(request.method, method);
				return new Response('failure', {status: 500});
			},
		}), {name: 'HTTPError'});

		t.is(attempts, expectedAttempts);
	});
}

test('does retry on 408 with methods provided as uppercase array', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		response.sendStatus(408);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				methods: ['GET'],
			},
		}).text(),
		{
			message: /Request Timeout/,
		},
	);

	t.is(requestCount, 4);
});

test('does retry on 408 with statusCodes provided as array', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('doesn\'t retry when retry.limit is set to 0', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('streaming body POST succeeds when retry.limit is 0', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		response.send(await parseRawBody(request));
	});

	const body = 'hello stream';
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});

	const result = await ky.post(server.url, {
		// @ts-expect-error - Types are outdated.
		duplex: 'half',
		body: stream,
		retry: {limit: 0},
	}).text();

	t.is(result, body);
});

test('streaming body is canceled once when retry.limit is 0 and fetch throws', async t => {
	let cancelCount = 0;
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('cancel me'));
		},
		cancel() {
			cancelCount++;
		},
	});

	const expectedError = new Error('fetch failed');
	let fetchCallCount = 0;
	await t.throwsAsync(ky.post('https://example.com', {
		// @ts-expect-error - Types are outdated.
		duplex: 'half',
		body: stream,
		retry: {limit: 0},
		async fetch() {
			fetchCallCount++;
			throw expectedError;
		},
	}).text(), {
		is: expectedError,
	});

	t.is(fetchCallCount, 1);
	t.is(cancelCount, 1);
});

test('streaming body POST retries and succeeds when retry.limit is above 0', async t => {
	let requestCount = 0;
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.sendStatus(408);
			return;
		}

		response.send(await parseRawBody(request));
	});

	const body = 'retry stream body';
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});

	const result = await ky.post(server.url, {
		// @ts-expect-error - Types are outdated.
		duplex: 'half',
		body: stream,
		retry: {
			limit: 1,
			methods: ['post'],
			statusCodes: [408],
		},
	}).text();

	t.is(result, body);
	t.is(requestCount, 2);
});

test('throws when retry.methods is not an array', async t => {
	const server = await createHttpTestServer(t);

	t.throws(() => {
		void ky(server.url, {
			retry: {
				// @ts-expect-error
				methods: 'get',
			},
		});
	});

	t.throws(() => {
		void ky(server.url, {
			retry: {
				// @ts-expect-error
				methods: 'get',
			},
			hooks: {
				init: [() => undefined],
			},
		});
	});
});

test('throws when retry.statusCodes is not an array', async t => {
	const server = await createHttpTestServer(t);

	t.throws(() => {
		void ky(server.url, {
			retry: {
				// @ts-expect-error
				statusCodes: 403,
			},
		});
	});

	t.throws(() => {
		void ky(server.url, {
			retry: {
				// @ts-expect-error
				statusCodes: 403,
			},
			hooks: {
				init: [() => undefined],
			},
		});
	});
});

test('throws when retry.afterStatusCodes is not an array', async t => {
	const server = await createHttpTestServer(t);

	t.throws(() => {
		void ky(server.url, {
			retry: {
				// @ts-expect-error
				afterStatusCodes: 503,
			},
		});
	});

	t.throws(() => {
		void ky(server.url, {
			retry: {
				// @ts-expect-error
				afterStatusCodes: 503,
			},
			hooks: {
				init: [() => undefined],
			},
		});
	});
});

test('throws when retry array options are falsy non-arrays', t => {
	for (const [key, value] of [
		['methods', 0],
		['statusCodes', false],
		['afterStatusCodes', null],
	] as const) {
		const retry = {[key]: value};

		t.throws(() => {
			void ky('https://example.com', {
				retry: retry as never,
			});
		});

		t.throws(() => {
			void ky('https://example.com', {
				retry: retry as never,
				hooks: {
					init: [() => undefined],
				},
			});
		});
	}
});

test('request hooks cannot mutate default retry status codes', async t => {
	await ky('https://example.com', {
		async fetch() {
			return new Response('ok');
		},
		hooks: {
			beforeRequest: [({options}) => {
				options.retry.statusCodes!.push(418);
			}],
		},
	}).text();

	let requestCount = 0;
	await t.throwsAsync(
		ky('https://example.com', {
			async fetch() {
				requestCount++;
				return new Response(null, {status: 418});
			},
		}).text(),
		{
			message: /status code 418/,
		},
	);

	t.is(requestCount, 1);
});

test('request hooks cannot mutate custom retry arrays', async t => {
	const retry = {
		limit: 1,
		statusCodes: [500],
		afterStatusCodes: [500],
		delay: () => 0,
	};

	await ky('https://example.com', {
		retry,
		async fetch() {
			return new Response('ok');
		},
		hooks: {
			beforeRequest: [({options}) => {
				options.retry.statusCodes.push(418);
				options.retry.afterStatusCodes.push(418);
			}],
		},
	}).text();

	t.deepEqual(retry.statusCodes, [500]);
	t.deepEqual(retry.afterStatusCodes, [500]);

	let requestCount = 0;
	await t.throwsAsync(
		ky('https://example.com', {
			retry,
			async fetch() {
				requestCount++;
				return new Response(null, {status: 418});
			},
		}).text(),
		{
			message: /status code 418/,
		},
	);

	t.is(requestCount, 1);
});

test('validates retry array mutations from response hooks', async t => {
	await t.throwsAsync(
		ky('https://example.com', {
			async fetch() {
				return new Response(null, {status: 500});
			},
			hooks: {
				afterResponse: [({options}) => {
					options.retry.statusCodes = null as never;
				}],
			},
		}).text(),
		{
			message: 'retry.statusCodes must be an array',
		},
	);
});

test('validates retry array mutations before sending the request', async t => {
	let requestCount = 0;

	await t.throwsAsync(
		ky('https://example.com', {
			async fetch() {
				requestCount++;
				return new Response('ok');
			},
			hooks: {
				beforeRequest: [({options}) => {
					options.retry.statusCodes = null as never;
				}],
			},
		}).text(),
		{
			message: 'retry.statusCodes must be an array',
		},
	);

	t.is(requestCount, 0);
});

test('extending with shouldRetry undefined restores default retry behavior', async t => {
	let requestCount = 0;
	let shouldRetryCallCount = 0;
	const instance = ky.create({
		retry: {
			limit: 1,
			delay: () => 0,
			shouldRetry() {
				shouldRetryCallCount++;
				return false;
			},
		},
		async fetch() {
			requestCount++;
			return new Response('ok', {status: requestCount === 1 ? 500 : 200});
		},
	}).extend({retry: {shouldRetry: undefined}});

	t.is(await instance('https://example.com').text(), 'ok');
	t.is(requestCount, 2);
	t.is(shouldRetryCallCount, 0);
});

for (const retry of [0, {limit: 0, methods: ['post'], statusCodes: [418]}]) {
	test(`extending with retry undefined resets an inherited ${typeof retry}`, async t => {
		let requestCount = 0;
		const instance = ky.create({
			retry,
			async fetch() {
				requestCount++;
				return new Response('ok', {status: requestCount === 3 ? 200 : 500});
			},
		});
		const extended = instance.extend({retry: undefined});

		await t.throwsAsync(instance('https://example.com'), {name: 'HTTPError'});
		t.is(requestCount, 1);
		requestCount = 0;
		t.is(await extended('https://example.com').text(), 'ok');
		t.is(requestCount, 3);
	});
}

test('retry options ignore undefined overrides and keep defaults', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(500);
	});

	await t.throwsAsync(ky(server.url, {
		retry: {
			limit: undefined,
		},
	}).text(), {message: /Internal Server Error/});

	// Default limit is 2, so request should be attempted 3 times
	t.is(requestCount, defaultRetryCount + 1);
});

test.serial('respect maximum backoffLimit', async t => {
	const retryCount = 4;
	const backoffLimit = 13;
	let requestCount = 0;
	const calculatedDelays: number[] = [];

	await withCapturedTimeouts(async scheduledDelays => {
		t.is(await ky('https://example.com', {
			timeout: false,
			async fetch() {
				requestCount++;
				return requestCount === retryCount + 1
					? new Response(fixture)
					: new Response(null, {status: 500});
			},
			retry: {
				limit: retryCount,
				backoffLimit,
				delay(attemptCount) {
					const calculatedDelay = attemptCount * 5;
					calculatedDelays.push(calculatedDelay);
					return calculatedDelay;
				},
			},
		}).text(), fixture);

		t.deepEqual(calculatedDelays, [5, 10, 15, 20]);
		const relevantScheduledDelays = scheduledDelays.filter(delay => calculatedDelays.includes(delay) || delay === backoffLimit);
		t.deepEqual(relevantScheduledDelays, [5, 10, 13, 13]);
	});

	t.is(requestCount, 5);
});

test('backoffLimit: undefined treats as no limit (Infinity)', async t => {
	const retryCount = 4;
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	// When backoffLimit is undefined, it should behave the same as no limit
	// (i.e., delays should not be clamped, same as default behavior)
	await withPerformance({
		t,
		expectedDuration: 300 + 600 + 1200 + 2400,
		async test() {
			t.is(await ky(server.url, {
				retry: {
					limit: retryCount,
					backoffLimit: undefined,
				},
			}).text(), fixture);
		},
	});

	t.is(requestCount, 5);
});

test('respect custom retry.delay', async t => {
	const retryCount = 4;
	let requestCount = 0;

	const server = await createHttpTestServer(t);
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
});

test('jitter: true applies full jitter to delay', async t => {
	const retryCount = 3;
	let requestCount = 0;
	const delays: number[] = [];
	let lastTime = Date.now();

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		const now = Date.now();
		if (requestCount > 0) {
			delays.push(now - lastTime);
		}

		lastTime = now;
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await ky(server.url, {
		retry: {
			limit: retryCount,
			jitter: true,
		},
	}).text();

	t.is(requestCount, 4);

	// Full jitter should produce delays between 0 and the computed delay
	// Add 50% tolerance for system overhead and CI variability
	t.true(delays[0] >= 0 && delays[0] <= 450);
	t.true(delays[1] >= 0 && delays[1] <= 900);
	t.true(delays[2] >= 0 && delays[2] <= 1800);
});

test('jitter: custom function applies custom jitter', async t => {
	const retryCount = 3;
	let requestCount = 0;
	const jitterCalls: number[] = [];

	const customJitter = (delay: number) => {
		jitterCalls.push(delay);
		return delay * 0.5; // Half the delay
	};

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await ky(server.url, {
		retry: {
			limit: retryCount,
			jitter: customJitter,
		},
	}).text();

	t.is(requestCount, 4);
	t.is(jitterCalls.length, 3); // Called for each retry

	// Verify the jitter function received the correct delays
	t.is(jitterCalls[0], 300); // First retry
	t.is(jitterCalls[1], 600); // Second retry
	t.is(jitterCalls[2], 1200); // Third retry
});

test('jitter respects backoffLimit', async t => {
	const retryCount = 3;
	let requestCount = 0;
	const delays: number[] = [];
	let lastTime = Date.now();

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		const now = Date.now();
		if (requestCount > 0) {
			delays.push(now - lastTime);
		}

		lastTime = now;
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await ky(server.url, {
		retry: {
			limit: retryCount,
			backoffLimit: 500,
			jitter: true,
		},
	}).text();

	t.is(requestCount, 4);

	// With backoffLimit of 500, all delays should be <= 500ms
	// Even though the computed delays would be 300, 600, 1200
	// After jitter and backoffLimit, they should all be <= 500
	// Add 50% tolerance for system overhead and CI variability
	t.true(delays[0] >= 0 && delays[0] <= 750);
	t.true(delays[1] >= 0 && delays[1] <= 750);
	t.true(delays[2] >= 0 && delays[2] <= 750);
});

test('jitter works with custom delay function', async t => {
	const retryCount = 2;
	let requestCount = 0;
	const jitterCalls: number[] = [];

	const customJitter = (delay: number) => {
		jitterCalls.push(delay);
		return delay * 0.5;
	};

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === retryCount + 1) {
			response.end(fixture);
		} else {
			response.sendStatus(500);
		}
	});

	await ky(server.url, {
		retry: {
			limit: retryCount,
			delay: n => 100 * n, // Custom delay: 100ms, 200ms, etc.
			jitter: customJitter,
		},
	}).text();

	t.is(requestCount, 3);
	t.is(jitterCalls.length, 2);
	t.is(jitterCalls[0], 100); // First retry with custom delay
	t.is(jitterCalls[1], 200); // Second retry with custom delay
});

test('jitter is not applied when Retry-After header is present', async t => {
	const startTime = Date.now();
	let requestCount = 0;
	const jitterCalls: number[] = [];

	const customJitter = (delay: number) => {
		jitterCalls.push(delay);
		return delay * 0.5;
	};

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;

		if (requestCount === 3) {
			response.end((Date.now() - startTime).toString());
		} else {
			response.writeHead(429, {
				'Retry-After': 1,
			});
			response.end('');
		}
	});

	const timeElapsedInMs = Number(await ky(server.url, {
		retry: {
			jitter: customJitter,
		},
	}).text());

	// Should have made 3 requests (initial + 2 retries)
	t.is(requestCount, 3);
	// Jitter function should NOT have been called when Retry-After is present
	t.is(jitterCalls.length, 0);
	// Should have waited at least 2 seconds (1s per retry)
	t.true(timeElapsedInMs >= 2000);
});

test('retryOnTimeout: false (default) - does not retry on timeout', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		// Delay longer than timeout to trigger timeout
		await delay(1000);
		response.end(fixture);
	});

	await t.throwsAsync(
		ky(server.url, {
			timeout: 500,
			retry: {
				limit: 3,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.is(requestCount, 1); // Should not retry
});

test('timeout: false does not throw TimeoutError during retries', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.sendStatus(500);
			return;
		}

		response.end(fixture);
	});

	const result = await ky(server.url, {
		timeout: false,
		retry: {
			limit: 1,
		},
	}).text();

	t.is(result, fixture);
	t.is(requestCount, 2);
});

test('retryOnTimeout: each retry gets the full per-attempt timeout', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		if (requestCount <= 2) {
			// Delay longer than timeout to trigger timeout
			await delay(1000);
			response.end(fixture);
			return;
		}

		response.end(fixture);
	});

	const result = await ky(server.url, {
		timeout: 500,
		retry: {
			limit: 3,
			retryOnTimeout: true,
			delay: () => 0,
		},
	}).text();

	t.is(result, fixture);
	t.is(requestCount, 3);
});

test('totalTimeout takes precedence over retry limit', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		// Each attempt takes 300ms
		await delay(300);
		return new Response('', {status: 500});
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			totalTimeout: 500,
			retry: {
				limit: 10,
				delay: () => 0,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);
	// Each attempt takes ~300ms. With 500ms totalTimeout, only 1-2 attempts fit
	// before the budget is exhausted (far fewer than the limit of 10).
	t.true(requestCount >= 1 && requestCount <= 2);
});

test('shouldRetry: returns true cannot exceed totalTimeout budget', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		await delay(300);
		return new Response('', {status: 500});
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			totalTimeout: 500,
			retry: {
				limit: 5,
				shouldRetry: () => true,
				delay: () => 0,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);
	// At most 1-2 attempts fit within the 500ms totalTimeout (each takes ~300ms)
	t.true(requestCount >= 1 && requestCount <= 2);
});

test('totalTimeout bounds a never-ending shouldRetry callback', async t => {
	let markCallbackStarted: () => void;
	const callbackStarted = new Promise<void>(resolve => {
		markCallbackStarted = resolve;
	});
	const neverSettlingPromise = new Promise<never>(() => {
		void 0;
	});

	const request = ky('https://example.com', {
		fetch: async () => new Response('error', {status: 500}),
		totalTimeout: 500,
		retry: {
			async shouldRetry() {
				markCallbackStarted();
				await neverSettlingPromise;
			},
		},
	}).text();

	await callbackStarted;

	const result = await Promise.race([
		request.catch((error: unknown) => error),
		delay(2000).then(() => 'still pending'),
	]);

	t.true(result instanceof TimeoutError);
});

test('shouldRetry: returns false - prevents retry', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		response.sendStatus(500); // Normally retriable
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				shouldRetry: () => false, // Prevent all retries
			},
		}).text(),
		{
			message: /Internal Server Error/,
		},
	);

	t.is(requestCount, 1); // No retries
});

test('shouldRetry: returns undefined - uses default retry logic', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount <= 2) {
			response.sendStatus(500); // Retriable
		} else {
			response.end(fixture);
		}
	});

	const result = await ky(server.url, {
		retry: {
			limit: 3,
			shouldRetry: () => undefined, // Fall through to default
		},
	}).text();

	t.is(result, fixture);
	t.is(requestCount, 3); // Default retry behavior
});

test('shouldRetry: receives correct state object', async t => {
	let requestCount = 0;
	const states: Array<{errorName: string; retryCount: number}> = [];

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount <= 2) {
			response.sendStatus(500);
		} else {
			response.end(fixture);
		}
	});

	await ky(server.url, {
		retry: {
			limit: 3,
			shouldRetry({error, retryCount}) {
				states.push({errorName: error.name, retryCount});
				return undefined; // Use default logic
			},
		},
	}).text();

	t.is(states.length, 2);
	t.is(states[0].errorName, 'HTTPError');
	t.is(states[0].retryCount, 1); // First retry
	t.is(states[1].errorName, 'HTTPError');
	t.is(states[1].retryCount, 2); // Second retry
});

test('shouldRetry: custom business logic with HTTPError', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.sendStatus(400);
		} else if (requestCount === 2) {
			response.sendStatus(500);
		} else {
			response.end(fixture);
		}
	});

	const result = await ky(server.url, {
		retry: {
			limit: 3,
			async shouldRetry({error, retryCount}) {
				const {HTTPError} = await import('../source/index.js');
				if (error instanceof HTTPError) {
					const {status} = error.response;
					if (status === 400 && retryCount <= 1) {
						return true;
					}

					if (status >= 400 && status < 500) {
						return false;
					}
				}

				return undefined;
			},
		},
	}).text();

	t.is(result, fixture);
	t.is(requestCount, 3);
});

test('shouldRetry: error propagates if shouldRetry throws', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.sendStatus(500);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				shouldRetry() {
					throw new Error('shouldRetry failed');
				},
			},
		}).text(),
		{
			message: 'shouldRetry failed',
		},
	);
});

test('shouldRetry: works with TimeoutError', async t => {
	let requestCount = 0;
	const errorNames: string[] = [];

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		// Delay longer than timeout to trigger timeout
		await delay(1000);
		response.end(fixture);
	});

	await t.throwsAsync(
		ky(server.url, {
			timeout: 500,
			retry: {
				limit: 3,
				async shouldRetry({error}) {
					errorNames.push(error.name);
					return error instanceof TimeoutError;
				},
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);
	// Each retry gets the full per-attempt timeout, so shouldRetry is called for each of the 3 retries
	t.deepEqual(errorNames, ['TimeoutError', 'TimeoutError', 'TimeoutError']);
	t.is(requestCount, 4);
});

test('each retry gets the full per-attempt timeout (not a shared budget)', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			// First attempt: consume most of a 2000ms timeout, then return 500
			await delay(1500);
			response.sendStatus(500);
			return;
		}

		// Second attempt: also takes 1500ms, which would fail if timeout were a shared budget
		// (only ~500ms would remain), but succeeds because each retry gets the full 2000ms
		await delay(1500);
		response.end(fixture);
	});

	const result = await ky(server.url, {
		timeout: 2000,
		retry: {
			limit: 1,
			delay: () => 0,
		},
	}).text();

	t.is(result, fixture);
	t.is(requestCount, 2);
});

test('Retry-After delay is bounded by totalTimeout budget', async t => {
	let requestCount = 0;
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		response.writeHead(429, {
			'Retry-After': 5,
		});
		response.end('');
	});

	let timeoutError: Error | undefined;
	await withPerformance({
		t,
		expectedDuration: 1000,
		async test() {
			timeoutError = await t.throwsAsync(ky(server.url, {
				totalTimeout: 1000,
				retry: {
					limit: 15,
				},
			}).text());
		},
	});

	t.is(timeoutError?.name, 'TimeoutError');
	t.is(requestCount, 1);
});

test('shouldRetry: precedence over retryOnTimeout', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', async (_request, response) => {
		requestCount++;
		// Delay longer than timeout to trigger timeout
		await delay(1000);
		response.end(fixture);
	});

	await t.throwsAsync(
		ky(server.url, {
			timeout: 500,
			retry: {
				limit: 3,
				retryOnTimeout: true, // Would retry
				shouldRetry: () => false, // But shouldRetry prevents it
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.is(requestCount, 1); // No retries
});

test('shouldRetry: works with synchronous function', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount <= 2) {
			response.sendStatus(400);
		} else {
			response.end(fixture);
		}
	});

	const result = await ky(server.url, {
		retry: {
			limit: 3,
			shouldRetry: () => true, // Sync function returning true
		},
	}).text();

	t.is(result, fixture);
	t.is(requestCount, 3);
});

test('shouldRetry: non-boolean return values fall through to default logic', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount <= 2) {
			response.sendStatus(500); // Retriable by default
		} else {
			response.end(fixture);
		}
	});

	// Test with various non-boolean return values - all should fall through
	const result = await ky(server.url, {
		retry: {
			limit: 3,
			shouldRetry: () => 42 as any, // Non-boolean (number) falls through
		},
	}).text();

	t.is(result, fixture);
	t.is(requestCount, 3); // Should retry using default logic
});

test('shouldRetry: receives proper Error instance even for HTTPError', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.sendStatus(404);
	});

	let receivedError: Error | undefined;

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 1,
				shouldRetry({error}) {
					receivedError = error;
					// Verify it's a proper Error instance
					t.true(error instanceof Error);
					t.is(error.name, 'HTTPError');
					return false;
				},
			},
		}).text(),
	);

	// Ensure shouldRetry was called
	t.truthy(receivedError);
});

test('shouldRetry: combines with default status code logic when returning undefined', async t => {
	let requestCount = 0;
	const capturedStatuses: number[] = [];

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount === 1) {
			response.sendStatus(500); // Retriable
		} else if (requestCount === 2) {
			response.sendStatus(404); // Not retriable
		} else {
			response.end(fixture);
		}
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				async shouldRetry({error}) {
					const {HTTPError} = await import('../source/index.js');
					if (error instanceof HTTPError) {
						capturedStatuses.push(error.response.status);
					}

					return undefined; // Fall through to default logic
				},
			},
		}).text(),
		{
			message: /Not Found/,
		},
	);

	// Should retry on 500, then fail on 404
	t.is(requestCount, 2);
	t.deepEqual(capturedStatuses, [500, 404]);
});

test('shouldRetry: retryCount starts at 1 for first retry', async t => {
	const retryCounts: number[] = [];

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.sendStatus(500);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				shouldRetry({retryCount}) {
					retryCounts.push(retryCount);
					return retryCount < 3; // Stop at 3rd retry
				},
			},
		}).text(),
	);

	t.deepEqual(retryCounts, [1, 2, 3]);
});

test('shouldRetry: handles Promise return value correctly', async t => {
	let requestCount = 0;

	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		requestCount++;
		if (requestCount <= 2) {
			response.sendStatus(400);
		} else {
			response.end(fixture);
		}
	});

	const result = await ky(server.url, {
		retry: {
			limit: 3,
			shouldRetry: async () => true,
		},
	}).text();

	t.is(result, fixture);
	t.is(requestCount, 3);
});

test('shouldRetry: error propagates if shouldRetry returns rejected Promise', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.sendStatus(500);
	});

	await t.throwsAsync(
		ky(server.url, {
			retry: {
				limit: 3,
				// eslint-disable-next-line @typescript-eslint/promise-function-async
				shouldRetry: () => Promise.reject(new Error('shouldRetry Promise rejected')),
			},
		}).text(),
		{
			message: 'shouldRetry Promise rejected',
		},
	);
});

test('totalTimeout with timeout: false - per-attempt disabled, total enabled', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		if (requestCount === 1) {
			// First attempt takes too long
			await delay(300);
			return new Response('', {status: 500});
		}

		return new Response('ok');
	};

	const result = await ky('https://example.com', {
		fetch: customFetch,
		timeout: false,
		totalTimeout: 2000,
		retry: {
			limit: 2,
			delay: () => 0,
		},
	}).text();

	t.is(result, 'ok');
	t.is(requestCount, 2);
});

test('totalTimeout with timeout: false - exceeds total budget', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		await delay(600);
		return new Response('', {status: 500});
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: false,
			totalTimeout: 500,
			retry: {
				limit: 5,
				delay: () => 0,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.is(requestCount, 1);
});

test('totalTimeout bounds hanging HTTPError body reads when timeout is disabled', async t => {
	t.timeout(2000);
	let requestCount = 0;
	let hookError: Error | undefined;

	const customFetch: typeof fetch = async () => {
		requestCount++;

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"error":"partial"'));
			},
		});

		return new Response(body, {
			status: 500,
			headers: {'content-type': 'application/json'},
		});
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: false,
			totalTimeout: 250,
			retry: {
				limit: 5,
				delay: () => 0,
			},
			hooks: {
				beforeError: [
					({error}) => {
						hookError = error;
						error.message = 'http-error-body-timeout-beforeError';
						return error;
					},
				],
			},
		}).text(),
		{
			name: 'TimeoutError',
			message: 'http-error-body-timeout-beforeError',
		},
	);

	t.is(requestCount, 1);
	t.true(hookError instanceof TimeoutError);
});

test('totalTimeout bounds hanging HTTPError body reads when timeout is larger', async t => {
	t.timeout(2000);
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"error":"partial"'));
			},
		});

		return new Response(body, {
			status: 500,
			headers: {'content-type': 'application/json'},
		});
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: 1000,
			totalTimeout: 250,
			retry: {
				limit: 5,
				delay: () => 0,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.is(requestCount, 1);
});

test.serial('totalTimeout is rechecked after per-attempt HTTPError body timeout', async t => {
	t.timeout(2000);
	const originalPerformanceNow = globalThis.performance.now;
	let performanceNowCallCount = 0;
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"error":"partial"'));
			},
		});

		return new Response(body, {
			status: 500,
			headers: {'content-type': 'application/json'},
		});
	};

	globalThis.performance.now = () => {
		performanceNowCallCount++;
		return performanceNowCallCount < 4 ? 0 : 100;
	};

	try {
		await t.throwsAsync(
			ky('https://example.com', {
				fetch: customFetch,
				timeout: 50,
				totalTimeout: 51,
				retry: 0,
			}).text(),
			{
				name: 'TimeoutError',
			},
		);
	} finally {
		globalThis.performance.now = originalPerformanceNow;
	}

	t.is(requestCount, 1);
	t.true(performanceNowCallCount >= 4);
});

test('totalTimeout bounds hanging HTTPError parseJson when timeout is disabled', async t => {
	t.timeout(2000);
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		return new Response('{"error":"parse-timeout"}', {
			status: 500,
			headers: {'content-type': 'application/json'},
		});
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: false,
			totalTimeout: 250,
			parseJson: async () => new Promise<never>(() => {
				// Intentionally never settles
			}),
			retry: {
				limit: 5,
				delay: () => 0,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.is(requestCount, 1);
});

test('totalTimeout smaller than timeout - effective timeout is capped', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		// Takes 800ms, within the 10s per-attempt timeout but exceeding 500ms totalTimeout
		await delay(800);
		return new Response('ok');
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: 10_000,
			totalTimeout: 500,
			retry: {
				limit: 2,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.is(requestCount, 1);
});

test('totalTimeout: 0 throws immediately', async t => {
	let fetchCalled = false;

	const customFetch: typeof fetch = async () => {
		fetchCalled = true;
		return new Response('ok');
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			totalTimeout: 0,
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.false(fetchCalled);
});

test('totalTimeout exceeding maxSafeTimeout throws RangeError', async t => {
	await t.throwsAsync(
		ky('https://example.com', {
			fetch: async () => new Response('ok'),
			totalTimeout: 2_147_483_648,
		}).text(),
		{
			instanceOf: RangeError,
		},
	);
});

test('totalTimeout expires mid-delay between retries', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		return new Response('', {status: 500});
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			totalTimeout: 200,
			retry: {
				limit: 5,
				// Delay is 500ms, longer than the remaining totalTimeout budget
				delay: () => 500,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	// First request succeeds quickly, but the 500ms delay exceeds the remaining budget
	t.is(requestCount, 1);
});

test('totalTimeout caps total time while timeout caps each attempt', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		// Each attempt takes 200ms (within 300ms per-attempt timeout)
		await delay(200);
		return new Response('', {status: 500});
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: 300,
			totalTimeout: 800,
			retry: {
				limit: 10,
				delay: () => 0,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.true(requestCount >= 2 && requestCount < 10, `Expected totalTimeout to allow retries but cap below the retry limit, got ${requestCount}`);
});

test('totalTimeout works with ky.create()', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		await delay(600);
		return new Response('', {status: 500});
	};

	const api = ky.create({
		fetch: customFetch,
		totalTimeout: 500,
		retry: {
			limit: 3,
			delay: () => 0,
		},
	});

	await t.throwsAsync(api('https://example.com').text(), {
		name: 'TimeoutError',
	});

	t.is(requestCount, 1);
});

test('totalTimeout can be overridden via extend()', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		await delay(10);
		if (requestCount <= 2) {
			return new Response('', {status: 500});
		}

		return new Response('ok');
	};

	const parent = ky.create({
		fetch: customFetch,
		totalTimeout: 1,
		retry: {
			limit: 3,
			delay: () => 0,
		},
	});

	// Override totalTimeout to a generous value
	const child = parent.extend({totalTimeout: 10_000});

	const result = await child('https://example.com').text();
	t.is(result, 'ok');
	t.is(requestCount, 3);
});

test('totalTimeout can be disabled via extend()', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		if (requestCount === 1) {
			await delay(200);
			return new Response('', {status: 500});
		}

		return new Response('ok');
	};

	const parent = ky.create({
		fetch: customFetch,
		totalTimeout: 100,
		retry: {
			limit: 2,
			delay: () => 0,
		},
	});

	// Disable totalTimeout
	const child = parent.extend({totalTimeout: false});

	const result = await child('https://example.com').text();
	t.is(result, 'ok');
	t.is(requestCount, 2);
});

test('totalTimeout with retryOnTimeout: true caps total time across retries', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		// Each attempt takes longer than the per-attempt timeout, so every attempt times out.
		await delay(300);
		return new Response('ok');
	};

	await t.throwsAsync(
		ky('https://example.com', {
			fetch: customFetch,
			timeout: 100,
			totalTimeout: 2000,
			retry: {
				limit: 30,
				retryOnTimeout: true,
				delay: () => 0,
			},
		}).text(),
		{
			name: 'TimeoutError',
		},
	);

	t.true(requestCount >= 2 && requestCount < 30, `Expected retryOnTimeout to retry but totalTimeout to cap below the retry limit, got ${requestCount}`);
});

test('NetworkError wraps fetch network errors', async t => {
	const error = await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				throw new TypeError('Failed to fetch');
			},
		}),
	);

	t.true(error instanceof NetworkError);
	t.true(isNetworkError(error));
	t.true(isKyError(error));
	t.is(error.name, 'NetworkError');
	t.true(error.request.url.includes('example.com'));
	t.true(error.cause instanceof TypeError);
	t.is((error.cause as TypeError).message, 'Failed to fetch');
	t.is(error.message, 'Request failed due to a network error: GET https://example.com/');
});

test('NetworkError wraps Safari network errors with domain', async t => {
	const error = await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				const error = new TypeError('Load failed (api.example.com)');
				error.stack = undefined;
				throw error;
			},
		}),
	);

	t.true(error instanceof NetworkError);
	t.true(isNetworkError(error));
	t.true(error!.cause instanceof TypeError);
	t.is((error!.cause as TypeError).message, 'Load failed (api.example.com)');
});

test('NetworkError does not wrap stacked Safari Load failed errors with domain', async t => {
	const error = await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				throw new TypeError('Load failed (api.example.com)');
			},
		}),
	);

	t.true(error instanceof TypeError);
	t.false(isNetworkError(error));
	t.is(error.message, 'Load failed (api.example.com)');
});

test('non-network TypeError is not retried', async t => {
	let fetchCallCount = 0;

	await t.throwsAsync(
		ky('https://example.com', {
			retry: {
				limit: 2,
				delay: () => 0,
			},
			async fetch() {
				fetchCallCount++;
				throw new TypeError('Cannot read properties of undefined');
			},
		}),
		{instanceOf: TypeError},
	);

	t.is(fetchCallCount, 1);
});

test('shouldRetry can force retry of non-network errors', async t => {
	let fetchCallCount = 0;

	await t.throwsAsync(
		ky('https://example.com', {
			retry: {
				limit: 2,
				delay: () => 0,
				shouldRetry: () => true,
			},
			async fetch() {
				fetchCallCount++;
				throw new TypeError('Cannot read properties of undefined');
			},
		}),
		{instanceOf: TypeError},
	);

	// 1 initial + 2 retries
	t.is(fetchCallCount, 3);
});

for (const thrownValue of [null, 'Temporary failure']) {
	test(`beforeRetry wraps non-Error exceptions: ${JSON.stringify(thrownValue)}`, async t => {
		let fetchCallCount = 0;
		let beforeRetryCallCount = 0;

		const result = await ky('https://example.com', {
			retry: {
				limit: 1,
				delay: () => 0,
				shouldRetry: () => true,
			},
			async fetch() {
				fetchCallCount++;
				if (fetchCallCount === 1) {
					// Exercise JavaScript's ability to throw arbitrary values.
					// eslint-disable-next-line @typescript-eslint/only-throw-error
					throw thrownValue;
				}

				return new Response('ok');
			},
			hooks: {
				beforeRetry: [({error}) => {
					beforeRetryCallCount++;
					t.true(error instanceof NonError);
					t.is((error as NonError).value, thrownValue);
					t.is(typeof error.message, 'string');
				}],
			},
		}).text();

		t.is(result, 'ok');
		t.is(fetchCallCount, 2);
		t.is(beforeRetryCallCount, 1);
	});
}

test('NetworkError is retried by default', async t => {
	let fetchCallCount = 0;

	const result = await ky('https://example.com', {
		retry: {
			limit: 2,
			delay: () => 0,
		},
		async fetch() {
			fetchCallCount++;
			if (fetchCallCount <= 2) {
				throw new TypeError('Failed to fetch');
			}

			return new Response('ok');
		},
	}).text();

	t.is(result, 'ok');
	t.is(fetchCallCount, 3);
});

test('NetworkError is not retried for non-retriable method (POST)', async t => {
	let fetchCallCount = 0;

	const error = await t.throwsAsync(
		ky.post('https://example.com', {
			retry: {
				limit: 2,
				delay: () => 0,
			},
			async fetch() {
				fetchCallCount++;
				throw new TypeError('Failed to fetch');
			},
		}),
	);

	t.true(isNetworkError(error));
	t.is(fetchCallCount, 1);
});

test('shouldRetry receives NetworkError (not raw TypeError)', async t => {
	let receivedError: Error | undefined;

	await t.throwsAsync(
		ky('https://example.com', {
			retry: {
				limit: 1,
				delay: () => 0,
				shouldRetry({error}) {
					receivedError = error;
					return false;
				},
			},
			async fetch() {
				throw new TypeError('Failed to fetch');
			},
		}),
	);

	t.true(isNetworkError(receivedError));
	t.true(receivedError!.cause instanceof TypeError);
});

test('non-network TypeError is not wrapped in NetworkError', async t => {
	const error = await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				throw new TypeError('Cannot read properties of undefined');
			},
		}),
	);

	t.true(error instanceof TypeError);
	t.false(isNetworkError(error));
	t.is(error.message, 'Cannot read properties of undefined');
});

test('shouldRetry returning undefined for NetworkError falls through to default retry', async t => {
	let fetchCallCount = 0;

	const result = await ky('https://example.com', {
		retry: {
			limit: 2,
			delay: () => 0,
			shouldRetry() {
				return undefined;
			},
		},
		async fetch() {
			fetchCallCount++;
			if (fetchCallCount <= 2) {
				throw new TypeError('Failed to fetch');
			}

			return new Response('ok');
		},
	}).text();

	t.is(result, 'ok');
	t.is(fetchCallCount, 3);
});

test('beforeError hook receives NetworkError with cause chain', async t => {
	let receivedError: Error | undefined;

	await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			async fetch() {
				throw new TypeError('Failed to fetch');
			},
			hooks: {
				beforeError: [
					({error}) => {
						receivedError = error;
						return error;
					},
				],
			},
		}),
	);

	t.true(receivedError instanceof NetworkError);
	t.true(isNetworkError(receivedError));
	t.is(receivedError!.name, 'NetworkError');
	t.true(receivedError!.cause instanceof TypeError);
	t.is((receivedError!.cause as TypeError).message, 'Failed to fetch');
});

test('NetworkError is thrown when timeout is disabled', async t => {
	const error = await t.throwsAsync(
		ky('https://example.com', {
			timeout: false,
			retry: 0,
			async fetch() {
				throw new TypeError('Failed to fetch');
			},
		}),
	);

	t.true(isNetworkError(error));
	t.is(error.name, 'NetworkError');
	t.true(error.cause instanceof TypeError);
});

const createCutConnectionServer = async (t: ExecutionContext) => {
	const server = await createHttpTestServer(t);
	let requestCount = 0;
	server.get('/', (request, response) => {
		requestCount++;
		response.set('content-type', 'application/json');
		response.write('{"partial":');
		setTimeout(() => {
			request.socket.destroy();
		}, 20);
	});

	return {
		server,
		getRequestCount: () => requestCount,
	};
};

test('NetworkError wraps a connection dropped while reading the body through shortcuts', async t => {
	const {server} = await createCutConnectionServer(t);

	for (const method of ['text', 'json', 'arrayBuffer', 'blob', 'bytes'] as const) {
		// eslint-disable-next-line no-await-in-loop
		const error = await t.throwsAsync(ky(server.url, {retry: 0})[method]());

		t.true(error instanceof NetworkError, method);
		t.true(isNetworkError(error), method);
		t.is(error.request.url, `${server.url}/`, method);
		t.true(error.cause instanceof TypeError, method);
		t.is(error.message, `Request failed due to a network error: GET ${server.url}/`, method);
	}
});

test('body read NetworkError runs beforeError hooks and is not retried', async t => {
	const {server, getRequestCount} = await createCutConnectionServer(t);
	const hookErrors: Array<{error: Error; retryCount: number}> = [];

	const error = await t.throwsAsync(
		ky(server.url, {
			retry: {limit: 2, delay: () => 0},
			hooks: {
				beforeError: [
					({error, retryCount}) => {
						hookErrors.push({error, retryCount});
						error.message = 'modified-by-beforeError';
						return error;
					},
				],
			},
		}).json(),
	);

	t.is(error.message, 'modified-by-beforeError');
	t.true(isNetworkError(error));
	t.is(hookErrors.length, 1);
	t.is(hookErrors[0]?.error, error);
	t.is(hookErrors[0]?.retryCount, 0);
	t.is(getRequestCount(), 1);
});

test('body read errors that are not network errors are thrown unchanged', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.set('content-type', 'application/json').end('{invalid');
	});

	let beforeErrorCalled = false;
	const error = await t.throwsAsync(
		ky(server.url, {
			retry: 0,
			hooks: {
				beforeError: [
					({error}) => {
						beforeErrorCalled = true;
						return error;
					},
				],
			},
		}).json(),
		{instanceOf: SyntaxError},
	);

	t.false(isNetworkError(error));
	t.false(beforeErrorCalled);
});

test('a body failing after the body read timed out does not run beforeError hooks again', async t => {
	const hookErrorNames: string[] = [];

	const error = await t.throwsAsync(
		ky('https://example.com', {
			retry: 0,
			timeout: 50,
			async fetch() {
				// A body stream that ignores the abort signal and fails on its own later.
				return new Response(new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('partial'));
						setTimeout(() => {
							controller.error(new TypeError('terminated'));
						}, 150);
					},
				}));
			},
			hooks: {
				beforeError: [
					({error}) => {
						hookErrorNames.push(error.name);
						return error;
					},
				],
			},
		}).text(),
		{instanceOf: TimeoutError},
	);

	t.is(error.name, 'TimeoutError');
	await delay(300);
	t.deepEqual(hookErrorNames, ['TimeoutError']);
});

test('native body methods on the returned response are not wrapped', async t => {
	const {server} = await createCutConnectionServer(t);

	const response = await ky(server.url, {retry: 0});
	const error = await t.throwsAsync(response.text(), {instanceOf: TypeError});

	t.false(isNetworkError(error));
});

// Chromium reports a user abort during a fetch or body read as `TypeError: Failed to fetch` instead of an `AbortError`.
const createAbortDuringBodyFetch = (): typeof fetch => async input => {
	const {signal} = input as Request;
	const encoder = new TextEncoder();

	return new Response(new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode('{"partial":'));
			const fail = () => {
				controller.error(new TypeError('Failed to fetch'));
			};

			if (signal.aborted) {
				fail();
				return;
			}

			signal.addEventListener('abort', fail, {once: true});
		},
	}), {headers: {'content-type': 'application/json'}});
};

const createAbortDuringFetch = (onRequest?: () => void): typeof fetch => async input => {
	onRequest?.();
	const {signal} = input as Request;

	return new Promise<Response>((_resolve, reject) => {
		const fail = () => {
			reject(new TypeError('Failed to fetch'));
		};

		if (signal.aborted) {
			fail();
			return;
		}

		signal.addEventListener('abort', fail, {once: true});
	});
};

test('a user abort during a body read throws the abort reason instead of NetworkError', async t => {
	for (const method of ['text', 'json', 'arrayBuffer', 'blob', 'bytes'] as const) {
		const abortController = new AbortController();
		const bodyPromise = ky('https://example.com', {retry: 0, signal: abortController.signal, fetch: createAbortDuringBodyFetch()})[method]();
		abortController.abort();

		// eslint-disable-next-line no-await-in-loop
		const error = await t.throwsAsync(bodyPromise);
		t.false(isNetworkError(error), method);
		t.is(error.name, 'AbortError', method);
	}
});

test('a user abort during a body read does not run beforeError hooks with a NetworkError', async t => {
	const hookErrors: Error[] = [];
	const abortController = new AbortController();
	const bodyPromise = ky('https://example.com', {
		retry: 0,
		signal: abortController.signal,
		fetch: createAbortDuringBodyFetch(),
		hooks: {
			beforeError: [
				({error}) => {
					hookErrors.push(error);
					return error;
				},
			],
		},
	}).text();
	abortController.abort();

	await t.throwsAsync(bodyPromise, {name: 'AbortError'});
	t.false(hookErrors.some(error => isNetworkError(error)));
});

test('an abort through a Request input during a body read is not wrapped in NetworkError', async t => {
	const abortController = new AbortController();
	const request = new Request('https://example.com', {signal: abortController.signal});
	const bodyPromise = ky(request, {retry: 0, fetch: createAbortDuringBodyFetch()}).text();
	abortController.abort();

	const error = await t.throwsAsync(bodyPromise);
	t.false(isNetworkError(error));
	t.is(error.name, 'AbortError');
});

test('an abort through a signal merged from an extended instance during a body read is not wrapped in NetworkError', async t => {
	const instanceController = new AbortController();
	const requestController = new AbortController();
	const api = ky.create({signal: instanceController.signal, retry: 0, fetch: createAbortDuringBodyFetch()});
	const bodyPromise = api('https://example.com', {signal: requestController.signal}).text();
	instanceController.abort();

	const error = await t.throwsAsync(bodyPromise);
	t.false(isNetworkError(error));
	t.is(error.name, 'AbortError');
});

test('an abort with a custom reason during a body read throws that reason', async t => {
	const reason = new Error('custom reason');
	const abortController = new AbortController();
	const bodyPromise = ky('https://example.com', {retry: 0, signal: abortController.signal, fetch: createAbortDuringBodyFetch()}).text();
	abortController.abort(reason);

	await t.throwsAsync(bodyPromise, {is: reason});
});

test('a user abort during a body read is not wrapped in NetworkError when timeout is disabled', async t => {
	const abortController = new AbortController();
	const bodyPromise = ky('https://example.com', {
		retry: 0,
		timeout: false,
		signal: abortController.signal,
		fetch: createAbortDuringBodyFetch(),
	}).text();
	abortController.abort();

	const error = await t.throwsAsync(bodyPromise);
	t.false(isNetworkError(error));
	t.is(error.name, 'AbortError');
});

test('a body read that fails with a network error while the signal is not aborted is still wrapped in NetworkError', async t => {
	const abortController = new AbortController();
	const error = await t.throwsAsync(ky('https://example.com', {
		retry: 0,
		signal: abortController.signal,
		async fetch() {
			return new Response(new ReadableStream({
				start(controller) {
					controller.error(new TypeError('Failed to fetch'));
				},
			}));
		},
	}).text());

	t.true(isNetworkError(error));
	t.false(abortController.signal.aborted);
});

test('a user abort during the fetch throws the abort reason instead of NetworkError', async t => {
	const abortController = new AbortController();
	const responsePromise = ky('https://example.com', {retry: 0, signal: abortController.signal, fetch: createAbortDuringFetch()});
	abortController.abort();

	const error = await t.throwsAsync(responsePromise);
	t.false(isNetworkError(error));
	t.is(error.name, 'AbortError');
});

test('a user abort with a custom reason during the fetch throws that reason', async t => {
	const reason = new Error('custom reason');
	const abortController = new AbortController();
	const responsePromise = ky('https://example.com', {retry: 0, signal: abortController.signal, fetch: createAbortDuringFetch()});
	abortController.abort(reason);

	await t.throwsAsync(responsePromise, {is: reason});
});

test('a user abort during the fetch is not retried as a network error', async t => {
	let requestCount = 0;
	const abortController = new AbortController();
	const responsePromise = ky('https://example.com', {
		retry: {limit: 2, delay: () => 0},
		signal: abortController.signal,
		fetch: createAbortDuringFetch(() => {
			requestCount++;
		}),
	});
	abortController.abort();

	const error = await t.throwsAsync(responsePromise);
	t.is(error.name, 'AbortError');
	t.is(requestCount, 1);
});

test('a user abort during the fetch reaches beforeError hooks as the abort reason', async t => {
	const hookErrors: Error[] = [];
	const abortController = new AbortController();
	const responsePromise = ky('https://example.com', {
		retry: 0,
		signal: abortController.signal,
		fetch: createAbortDuringFetch(),
		hooks: {
			beforeError: [
				({error}) => {
					hookErrors.push(error);
					return error;
				},
			],
		},
	});
	abortController.abort();

	await t.throwsAsync(responsePromise, {name: 'AbortError'});
	t.is(hookErrors.length, 1);
	t.is(hookErrors[0]?.name, 'AbortError');
});

test('retries preserve the request referrer and referrer policy', async t => {
	const requests: Request[] = [];
	const referrer = 'https://example.com/source';
	const referrerPolicy = 'no-referrer';

	await ky('https://example.com', {
		referrer,
		referrerPolicy,
		retry: {limit: 1, delay: () => 0},
		async fetch(input) {
			requests.push(input as Request);
			return new Response('', {status: requests.length === 1 ? 500 : 200});
		},
	});

	t.is(requests.length, 2);
	for (const request of requests) {
		t.is(request.referrer, referrer);
		t.is(request.referrerPolicy, referrerPolicy);
	}
});

test.serial('a user abort of a retried fetch throws the abort reason instead of NetworkError', async t => {
	let requestCount = 0;
	const abortController = new AbortController();
	const responsePromise = ky('https://example.com', {
		timeout: 1000,
		retry: {limit: 1, delay: () => 0},
		signal: abortController.signal,
		hooks: {
			beforeRetry: [async () => {
				// Collect intermediate controllers created by Request.clone() before aborting the retry.
				const detector = new LeakDetector({});
				await detector.isLeaking();
				await detector.isLeaking();
			}],
		},
		async fetch(input) {
			requestCount++;
			if (requestCount === 1) {
				return new Response('error', {status: 500});
			}

			abortController.abort();
			return createAbortDuringFetch()(input);
		},
	});

	const error = await t.throwsAsync(responsePromise);
	t.false(isNetworkError(error));
	t.is(error.name, 'AbortError');
	t.is(requestCount, 2);
});

for (const explicitParentRetry of [false, true]) {
	test(`replacing retry methods works with explicit parent retry ${explicitParentRetry}`, async t => {
		let fetchCalls = 0;
		let hookCalls = 0;
		const parent = ky.create({
			retry: explicitParentRetry ? {limit: 2} : undefined,
			async fetch() {
				fetchCalls++;
				return new Response(fetchCalls === 1 ? 'Try again' : 'ok', {status: fetchCalls === 1 ? 500 : 200});
			},
		});
		const api = parent.extend({
			retry: {methods: replaceOption(['post']), delay: () => 0},
			hooks: {
				beforeRequest: [({options}) => {
					hookCalls++;
					t.deepEqual(options.retry.methods, ['post']);
				}],
			},
		});

		t.is(await api.post('https://example.com').text(), 'ok');
		t.is(fetchCalls, 2);
		t.is(hookCalls, 1);
	});
}

for (const property of ['statusCodes', 'afterStatusCodes'] as const) {
	test(`replacing retry ${property} without parent retry options retains Retry-After handling`, async t => {
		let fetchCalls = 0;
		let hookCalls = 0;
		const api = ky.extend({
			retry: {
				[property]: replaceOption([500]),
				...(property === 'statusCodes' ? {afterStatusCodes: [500]} : {}),
				delay() {
					t.fail('Retry-After must determine the delay');
					return 0;
				},
			},
			hooks: {
				beforeRequest: [({options}) => {
					hookCalls++;
					t.deepEqual(options.retry[property], [500]);
				}],
			},
			async fetch() {
				fetchCalls++;
				return new Response(fetchCalls === 1 ? 'Try again' : 'ok', {
					status: fetchCalls === 1 ? 500 : 200,
					headers: {'retry-after': '0'},
				});
			},
		});

		t.is(await api('https://example.com').text(), 'ok');
		t.is(fetchCalls, 2);
		t.is(hookCalls, 1);
	});
}

test('replacing the whole retry option also resolves nested list replacements', async t => {
	let fetchCalls = 0;
	const api = ky.create({retry: {limit: 0, methods: ['get']}}).extend({
		retry: replaceOption({methods: replaceOption(['post']), delay: () => 0}),
		async fetch() {
			fetchCalls++;
			return new Response(fetchCalls === 1 ? 'Try again' : 'ok', {status: fetchCalls === 1 ? 500 : 200});
		},
	});

	t.is(await api.post('https://example.com').text(), 'ok');
	t.is(fetchCalls, 2);
});
