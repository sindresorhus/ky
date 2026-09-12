import test from 'ava';
import {NetworkError, isNetworkError} from '../source/index.js';

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
