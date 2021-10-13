import test from 'ava';
import {HTTPError} from '../source/index.js';
import {Mutable} from '../source/utils/types.js';

function createFakeResponse({status, statusText}: {status?: number; statusText?: string}): Response {
	// Start with a realistic fetch Response.
	const response: Partial<Mutable<Response>> = {...new Response()};

	response.status = status;
	response.statusText = statusText;

	return response as Response;
}

test('HTTPError handles undefined response.statusText', t => {
	const status = 500;
	// @ts-expect-error missing Request
	const error = new HTTPError(
		// This simulates the case where a browser Response object does
		// not define statusText, such as IE, Safari, etc.
		// See https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText#Browser_compatibility
		createFakeResponse({statusText: undefined, status}),
	);

	t.is(error.message, 'Request failed with status code 500');
});

test('HTTPError handles undefined response.status', t => {
	// @ts-expect-error missing Request
	const error = new HTTPError(
		// This simulates a catastrophic case where some unexpected
		// response object was sent to HTTPError.
		createFakeResponse({statusText: undefined, status: undefined}),
	);

	t.is(error.message, 'Request failed with an unknown error');
});

test('HTTPError handles a response.status of 0', t => {
	// @ts-expect-error missing Request
	const error = new HTTPError(
		// Apparently, it's possible to get a response status of 0.
		createFakeResponse({statusText: undefined, status: 0}),
	);

	t.is(error.message, 'Request failed with status code 0');
});
