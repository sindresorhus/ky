import test from 'ava';
import ky, {NetworkError, isNetworkError} from '../source/index.js';

for (const limit of [0, 1]) {
	test(`NetworkError refers to the failed outgoing request with retry limit ${limit}`, async t => {
		const requests: Request[] = [];
		const cause = new TypeError('fetch failed');
		const error = await t.throwsAsync(ky('https://example.com', {
			retry: {limit, delay: () => 0},
			async fetch(request) {
				requests.push(request);
				request.headers.set('x-attempt', String(requests.length));
				throw cause;
			},
		}), {instanceOf: NetworkError});

		t.is(requests.length, limit + 1);
		t.is(error.request, requests.at(-1));
		t.is(error.request.headers.get('x-attempt'), String(limit + 1));
		t.is(error.cause, cause);
	});
}

test('beforeRetry sees the failed outgoing request while retaining its retry request', async t => {
	let failedRequest: Request | undefined;
	let hookCalls = 0;
	const result = await ky('https://example.com', {
		retry: {limit: 1, delay: () => 0},
		async fetch(request) {
			if (!failedRequest) {
				failedRequest = request;
				request.headers.set('x-attempt', 'failed');
				throw new TypeError('fetch failed');
			}

			t.is(request.headers.get('x-retry'), 'yes');
			return new Response('ok');
		},
		hooks: {
			beforeRetry: [({error, request}) => {
				hookCalls++;
				t.true(isNetworkError(error));
				if (isNetworkError(error)) {
					t.is(error.request, failedRequest);
					t.is(error.request.headers.get('x-attempt'), 'failed');
					t.not(error.request, request);
				}

				request.headers.set('x-retry', 'yes');
			}],
		},
	}).text();

	t.is(result, 'ok');
	t.is(hookCalls, 1);
});

test('NetworkError preserves optional causes', t => {
	const request = new Request('https://example.com');

	for (const cause of [undefined, new Error('Connection lost')]) {
		const error = new NetworkError(request, {cause});
		t.is(error.cause, cause);
		t.is(error.request, request);
		t.is(error.name, 'NetworkError');
		t.is(error.message, 'Request failed due to a network error: GET https://example.com/');
		t.true(isNetworkError(error));
	}

	t.is(new NetworkError(request).cause, undefined);
});
