import test from 'ava';
import {normalizeRetryMethod, normalizeRetryOptions} from '../source/utils/normalize.js';

test('retry shorthand and object options produce independent default arrays', t => {
	const expected = normalizeRetryOptions();

	for (const retry of [undefined, 2, {limit: 2}]) {
		const normalized = normalizeRetryOptions(retry);
		t.deepEqual(normalized, expected);
		normalized.methods.push('CUSTOM');
		normalized.statusCodes.push(418);
		normalized.afterStatusCodes.push(418);
		t.deepEqual(normalizeRetryOptions(retry), expected);
	}
});

test('retry validation preserves error messages and precedence', t => {
	t.throws(() => normalizeRetryOptions({limit: -1, methods: false} as never), {
		name: 'TypeError',
		message: '`retry.limit` must be a finite, non-negative integer',
	});

	for (const key of ['methods', 'statusCodes', 'afterStatusCodes']) {
		t.throws(() => normalizeRetryOptions({[key]: false} as never), {
			name: 'Error',
			message: `retry.${key} must be an array`,
		});
	}
});

test('retry validation accepts a disabled jitter', t => {
	t.false(normalizeRetryOptions({jitter: false}).jitter);
});

test('retry method normalization lowercases standard methods and preserves custom methods', t => {
	for (const [method, expected] of [
		['GET', 'get'],
		['OPTIONS', 'options'],
		['TRACE', 'trace'],
		['Purge', 'Purge'],
	]) {
		t.is(normalizeRetryMethod(method), expected);
	}

	t.deepEqual(normalizeRetryOptions({methods: ['TRACE', 'Purge'] as never}).methods, ['trace', 'Purge']);
});

test('retry limit validation accepts negative zero', t => {
	t.notThrows(() => normalizeRetryOptions(-0));
	t.notThrows(() => normalizeRetryOptions({limit: -0}));
});

test('retry validation accepts zero for maxRetryAfter and backoffLimit', t => {
	const normalized = normalizeRetryOptions({maxRetryAfter: 0, backoffLimit: 0});
	t.is(normalized.maxRetryAfter, 0);
	t.is(normalized.backoffLimit, 0);
});
