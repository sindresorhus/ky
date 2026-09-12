import test from 'ava';
import {normalizeRetryOptions} from '../source/utils/normalize.js';

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
