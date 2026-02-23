import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import {promiseWithTimeout} from './helpers/with-page.js';

test('promiseWithTimeout returns result when promise resolves in time', async t => {
	const result = await promiseWithTimeout(
		Promise.resolve('ok'),
		1000,
		'should not time out',
	);

	t.is(result, 'ok');
});

test('promiseWithTimeout throws when promise does not resolve in time', async t => {
	const startTime = Date.now();

	const error = await t.throwsAsync(
		promiseWithTimeout(
			delay(100),
			10,
			'timed out',
		),
	);

	t.is(error?.message, 'timed out');
	t.true(Date.now() - startTime < 100);
});
