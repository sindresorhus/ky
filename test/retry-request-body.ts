import test from 'ava';
import ky from '../source/index.js';

test('retry after fetch failure preserves the streaming request body', async t => {
	const encoder = new TextEncoder();
	const bodies: string[] = [];

	const result = await ky.post('https://example.com', {
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('retried 🦄'));
				controller.close();
			},
		}),
		retry: {limit: 1, methods: ['post'], delay: () => 0},
		async fetch(request) {
			const text = await request.text();
			if (bodies.length === 0) {
				bodies.push(text);
				// Node reports a dropped connection as this exact TypeError.
				throw new TypeError('fetch failed');
			}

			return new Response(text);
		},
	}).text();

	t.deepEqual(bodies, ['retried 🦄']);
	t.is(result, 'retried 🦄');
});
