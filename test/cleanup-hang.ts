import {Readable} from 'node:stream';
import test from 'ava';
import ky from '../source/index.js';

test('cleanup logic does not hang on stream request failure', async t => {
	const stream = Readable.from('Bell is Ringing.');
	const error = new TypeError('Simulated fetch error');

	await t.throwsAsync(
		ky.post('https://example.com', {
			body: stream,
			async fetch() {
				throw error;
			},
		}),
		{
			is: error,
		},
	);
});
