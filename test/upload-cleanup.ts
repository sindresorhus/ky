import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import ky from '../source/index.js';

test('the first attempt does not inspect the request body for previous upload cleanup', async t => {
	let bodyReads = 0;
	const result = await ky.post('https://example.com', {
		body: 'payload',
		hooks: {
			beforeRequest: [({request}) => {
				Object.defineProperty(request, 'body', {
					configurable: true,
					get() {
						bodyReads++;
						return undefined;
					},
				});
			}],
		},
		async fetch(request) {
			Reflect.deleteProperty(request, 'body');
			return new Response(await request.text());
		},
	}).text();

	t.is(result, 'payload');
	t.is(bodyReads, 0);
});

test('cancelling an unused attempt preserves the complete upload for retries', async t => {
	const payload = 'retry-payload';
	let attempts = 0;
	const result = await ky.put('https://example.com', {
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(payload));
				controller.close();
			},
		}),
		retry: {limit: 2, delay: () => 0},
		async fetch(request) {
			attempts++;
			if (attempts < 3) {
				return new Response('', {status: 503});
			}

			return new Response(await request.text());
		},
	}).text();

	t.is(attempts, 3);
	t.is(result, payload);
});

for (const failure of ['HTTP error', 'network error', 'forced retry'] as const) {
	test(`unused upload branches are cancelled after retrying a ${failure}`, async t => {
		let cancellations = 0;
		let attempts = 0;
		const requests: Request[] = [];
		const body = new ReadableStream({
			cancel() {
				cancellations++;
			},
		});
		t.teardown(() => {
			for (const request of requests) {
				void request.body?.cancel().catch(() => undefined);
			}
		});

		await ky.put('https://example.com', {
			body,
			retry: {limit: 1, delay: () => 0},
			hooks: {
				afterResponse: [({retryCount}) => {
					if (failure === 'forced retry' && retryCount === 0) {
						return ky.retry();
					}
				}],
			},
			async fetch(request) {
				requests.push(request);
				attempts++;
				if (attempts === 1) {
					if (failure === 'network error') {
						throw new TypeError('fetch failed');
					}

					return new Response('', {status: failure === 'forced retry' ? 200 : 503});
				}

				return new Response('ok');
			},
		});

		await delay(0);
		t.is(attempts, 2);
		t.is(cancellations, 1);
	});
}
