import test from 'ava';
import {calculateRetryTimingDelay, getRetryTimingHeader} from '../source/core/retry-timing.js';

// RFC 9110 §10.2.3 defines delay-seconds as 1*DIGIT, not JavaScript number syntax.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3
for (const value of ['-1', '+1', '1.5', '1e3', '1_000', '0b10', '0o10', '10seconds', '1 0', '１２']) {
	test(`Retry-After rejects non-decimal delay ${JSON.stringify(value)}`, t => {
		t.is(calculateRetryTimingDelay({value, allowTimestamp: false}), undefined);
	});
}

test('Retry-After accepts leading zeroes without interpreting them as octal', t => {
	t.is(calculateRetryTimingDelay({value: '000012', allowTimestamp: false}), 12_000);
});

test('Retry-After preserves integer seconds beyond the signed 32-bit range', t => {
	t.is(calculateRetryTimingDelay({value: '2147483648', allowTimestamp: false}), 2_147_483_648_000);
});

// Exercise invalid components independently so another invalid component cannot mask a missing check.
// HTTP-date syntax is case-sensitive: RFC 9110 §5.6.7.
for (const [description, value] of [
	['zero day', 'Wed, 00 Jan 2031 12:00:00 GMT'],
	['day overflow', 'Fri, 32 Jan 2031 12:00:00 GMT'],
	['short month overflow', 'Thu, 31 Apr 2031 12:00:00 GMT'],
	['non-leap February', 'Sat, 29 Feb 2031 12:00:00 GMT'],
	['unknown month', 'Wed, 01 Foo 2031 12:00:00 GMT'],
	['unknown weekday', 'Foo, 01 Jan 2031 12:00:00 GMT'],
	['hour overflow', 'Wed, 01 Jan 2031 24:00:00 GMT'],
	['minute overflow', 'Wed, 01 Jan 2031 12:60:00 GMT'],
	['second overflow', 'Wed, 01 Jan 2031 12:00:61 GMT'],
	['non-GMT zone', 'Wed, 01 Jan 2031 12:00:00 UTC'],
	['numeric zone', 'Wed, 01 Jan 2031 12:00:00 +0000'],
	['ISO timestamp', '2031-01-01T12:00:00Z'],
	['lowercase date', 'wed, 01 jan 2031 12:00:00 gmt'],
	['unpadded IMF day', 'Wed, 1 Jan 2031 12:00:00 GMT'],
]) {
	test(`Retry-After rejects HTTP dates with ${description}`, t => {
		t.is(calculateRetryTimingDelay({value: value!, allowTimestamp: false}), undefined);
	});
}

for (const [description, value, now, expected] of [
	['leap day', 'Thu, 29 Feb 2024 00:00:00 GMT', '2024-02-28T23:59:59Z', 1000],
	['space-padded asctime day', 'Sun Nov  6 08:49:37 1994', '1994-11-06T08:49:36Z', 1000],
	['past date', 'Wed, 01 Jan 2031 12:00:00 GMT', '2031-01-01T12:00:01Z', 0],
	['current date', 'Wed, 01 Jan 2031 12:00:00 GMT', '2031-01-01T12:00:00Z', 0],
] as const) {
	test.serial(`Retry-After calculates the delay for a ${description}`, t => {
		const originalNow = Date.now;
		t.teardown(() => {
			Date.now = originalNow;
		});
		Date.now = () => Date.parse(now);

		t.is(calculateRetryTimingDelay({value, allowTimestamp: false}), expected);
	});
}

test('Retry-After header names and outer whitespace are normalized by Headers', t => {
	const header = getRetryTimingHeader(new Headers({'rEtRy-AfTeR': '\t 012 \t'}));
	t.deepEqual(header, {value: '012', allowTimestamp: false});
	t.is(calculateRetryTimingDelay(header!), 12_000);
});

test('multiple Retry-After values do not become a valid delay or date', t => {
	const headers = new Headers();
	headers.append('Retry-After', '1');
	headers.append('Retry-After', '2');
	const header = getRetryTimingHeader(headers);
	t.deepEqual(header, {value: '1, 2', allowTimestamp: false});
	t.is(calculateRetryTimingDelay(header!), undefined);
});

// The "current era" cutoff used to be a hardcoded 2024-01-01, so a reset value from just before it fell below the cutoff and was read as delay seconds. A `RateLimit-Reset` of 1700000000 (November 2023) became a 54-year delay.
for (const [description, value, expected] of [
	['a November 2023 epoch as a reset in the past', '1700000000', 0],
	['a January 2023 epoch as a reset in the past', '1672531200', 0],
	['a 2001 epoch as a reset in the past', '1000000000', 0],
	['a value just below the threshold as a delay', '999999999', 999_999_999_000],
	['a small reset as a delay', '30', 30_000],
] as Array<[string, string, number]>) {
	test(`RateLimit-Reset reads ${description}`, t => {
		t.is(calculateRetryTimingDelay({value, allowTimestamp: true}), expected);
	});
}

test('Retry-After numbers are never treated as timestamps', t => {
	t.is(calculateRetryTimingDelay({value: '1700000000', allowTimestamp: false}), 1_700_000_000_000);
});

for (const [description, headers, expected] of [
	['RateLimit-Reset over X-RateLimit-Retry-After', {'RateLimit-Reset': '1', 'X-RateLimit-Retry-After': '2'}, {value: '1', allowTimestamp: true}],
	['X-RateLimit-Retry-After over X-RateLimit-Reset', {'X-RateLimit-Retry-After': '2', 'X-RateLimit-Reset': '3'}, {value: '2', allowTimestamp: false}],
	['X-RateLimit-Reset over X-Rate-Limit-Reset', {'X-RateLimit-Reset': '3', 'X-Rate-Limit-Reset': '4'}, {value: '3', allowTimestamp: true}],
] as const) {
	test(`retry timing header precedence prefers ${description}`, t => {
		t.deepEqual(getRetryTimingHeader(new Headers(headers)), expected);
	});
}

test('an empty X-RateLimit-Retry-After does not fall back to a reset header', t => {
	t.deepEqual(getRetryTimingHeader(new Headers({'X-RateLimit-Retry-After': '', 'X-RateLimit-Reset': '3'})), {value: '', allowTimestamp: false});
});

test('HTTP dates with a year below 100 are not mapped to the 1900s', t => {
	// `Date.UTC()` maps years 0-99 to 1900-1999. Such a date must still be a valid past date, not a malformed one that falls back to the normal retry delay.
	t.is(calculateRetryTimingDelay({value: 'Fri, 01 Jan 0010 00:00:00 GMT', allowTimestamp: false}), 0);
	t.is(calculateRetryTimingDelay({value: 'Fri Jan  1 00:00:00 0010', allowTimestamp: false}), 0);
});

test('RFC 850 date between 50 and 51 years in the future is interpreted as past', t => {
	// The RFC 850 century window uses the real clock, so build the date from it.
	const date = new Date();
	date.setUTCFullYear(date.getUTCFullYear() + 50, date.getUTCMonth() + 6);
	const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()];
	const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
	const [day, year, time] = [
		String(date.getUTCDate()).padStart(2, '0'),
		String(date.getUTCFullYear() % 100).padStart(2, '0'),
		date.toISOString().slice(11, 19),
	];

	t.is(calculateRetryTimingDelay({value: `${weekday}, ${day}-${month}-${year} ${time} GMT`, allowTimestamp: false}), 0);
});

test.serial('asctime date with a two-digit day is parsed', t => {
	const originalNow = Date.now;
	t.teardown(() => {
		Date.now = originalNow;
	});
	Date.now = () => Date.parse('2031-01-16T12:00:00Z');

	t.is(calculateRetryTimingDelay({value: 'Thu Jan 16 12:00:02 2031', allowTimestamp: false}), 2000);
});

test('Retry-After HTTP date in year 9999 gives a finite delay', t => {
	for (const value of ['Fri, 31 Dec 9999 23:59:59 GMT', 'Fri Dec 31 23:59:59 9999']) {
		const delay = calculateRetryTimingDelay({value, allowTimestamp: false});
		t.true(Number.isFinite(delay) && delay! > 0, `value: ${value}`);
	}
});

for (const [description, value] of [
	['IMF-fixdate', 'Wed, 31 Dec 2031 23:59:60 GMT'],
	['asctime', 'Wed Dec 31 23:59:60 2031'],
] as const) {
	test.serial(`Retry-After ${description} leap second at the end of a year resolves to the start of the next year`, t => {
		const originalNow = Date.now;
		t.teardown(() => {
			Date.now = originalNow;
		});
		Date.now = () => Date.parse('2031-12-31T23:59:59Z');

		t.is(calculateRetryTimingDelay({value, allowTimestamp: false}), 1000);
	});
}

// `Number()` of a long digit string overflows to `Infinity` rather than `NaN`, so the delay is unbounded but still a usable number for Ky to cap.
test('Retry-After with more digits than a number can hold gives an infinite delay', t => {
	t.is(calculateRetryTimingDelay({value: '9'.repeat(400), allowTimestamp: false}), Number.POSITIVE_INFINITY);
});
