import {setTimeout as delay} from 'node:timers/promises';
import test from 'ava';
import ky from '../source/index.js';

for (const hook of ['beforeRequest', 'beforeRetry'] as const) {
	test(`${hook} preserves an inherited body when replacing only headers`, async t => {
		let attempts = 0;
		const result = await ky.put('https://example.com', {
			body: 'original-payload',
			retry: {limit: 1, delay: () => 0},
			hooks: {
				[hook]: [({request}: {request: Request}) => new Request(request, {headers: {'x-replaced': 'yes'}})],
			},
			async fetch(request) {
				attempts++;
				if (hook === 'beforeRetry' && attempts === 1) {
					return new Response('', {status: 503});
				}

				t.is(request.headers.get('x-replaced'), 'yes');
				return new Response(await request.text());
			},
		}).text();

		t.is(result, 'original-payload');
	});
}

for (const hook of ['beforeRequest', 'beforeRetry'] as const) {
	test(`${hook} releases the unused body when replacing the request`, async t => {
		let cancellations = 0;
		let attempts = 0;
		let replacedRequest: Request | undefined;
		const body = new ReadableStream({
			cancel() {
				cancellations++;
			},
		});
		t.teardown(() => {
			void replacedRequest?.body?.cancel().catch(() => undefined);
		});
		const replacement = ({request}: {request: Request}) => {
			replacedRequest = request;
			return new Request(request.url, {method: 'PUT', body: 'replacement'});
		};

		const result = await ky.put('https://example.com', {
			body,
			retry: {limit: 1, delay: () => 0},
			hooks: {[hook]: [replacement]},
			async fetch(request) {
				attempts++;
				if (hook === 'beforeRetry' && attempts === 1) {
					return new Response('', {status: 503});
				}

				return new Response(await request.text());
			},
		}).text();

		await delay(0);
		t.is(result, 'replacement');
		t.is(cancellations, 1);
	});
}
