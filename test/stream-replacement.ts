import test from 'ava';
import ky from '../source/index.js';

test('beforeRequest can return a Request with a streaming body', async t => {
	const encoder = new TextEncoder();
	const result = await ky.post('https://example.com', {
		body: 'unused',
		retry: 0,
		hooks: {
			beforeRequest: [({request}) => new Request(request, {
				// @ts-expect-error - RequestInit types do not include duplex.
				duplex: 'half',
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode('streamed 🦄'));
						controller.close();
					},
				}),
			})],
		},
		async fetch(request) {
			return new Response(await request.text());
		},
	}).text();

	t.is(result, 'streamed 🦄');
});
