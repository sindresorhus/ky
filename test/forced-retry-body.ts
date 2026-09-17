import test from 'ava';
import ky from '../source/index.js';

for (const streaming of [false, true]) {
	test(`forced POST retry preserves each complete body with streaming ${streaming}`, async t => {
		const payload = 'first 🦄 second';
		const receivedBodies: string[] = [];
		const retryCounts: number[] = [];
		const encoder = new TextEncoder();
		const body = streaming
			? new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode('first 🦄 '));
					controller.enqueue(encoder.encode('second'));
					controller.close();
				},
			})
			: payload;

		const result = await ky.post('https://example.com', {
			body,
			retry: {limit: 1, delay: () => 0},
			async fetch(request) {
				receivedBodies.push(await request.text());
				return new Response('success');
			},
			hooks: {
				afterResponse: [({retryCount}) => {
					if (retryCount === 0) {
						return ky.retry();
					}
				}],
				beforeRetry: [({retryCount}) => {
					retryCounts.push(retryCount);
				}],
			},
		}).text();

		t.is(result, 'success');
		t.deepEqual(receivedBodies, [payload, payload]);
		t.deepEqual(retryCounts, [1]);
	});
}
