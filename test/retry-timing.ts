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
