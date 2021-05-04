import test from 'ava';
import ky from '../source/index.js';

function createFakeResponse({status, statusText}: {status?: number; statusText?: string}): Response {
	// Start with a realistic fetch Response.
	const response = {...new Response()};

	// Assign these values because the Response() constructor doesn't
	// support setting them to undefined.
	// @ts-expect-error
	response.status = status;
	// @ts-expect-error
	response.statusText = statusText;

	return response;
}

test('HTTPError handles undefined response.statusText', t => {
	const status = 500;
	// @ts-expect-error missing Request
	const error = new ky.HTTPError(
		// This simulates the case where a browser Response object does
		// not define statusText, such as IE, Safari, etc.
		// See https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText#Browser_compatibility
		createFakeResponse({statusText: undefined, status})
	);

	t.is(error.message, 'Request failed with status code 502');
});

test('HTTPError handles undefined response.status', t => {
	// @ts-expect-error missing Request
	const error = new ky.HTTPError(
		// This simulates a catastrophic case where some unexpected
		// response object was sent to HTTPError.
		createFakeResponse({statusText: undefined, status: undefined})
	);

	t.is(error.message, 'Request failed with an unknown error');
});

test('HTTPError handles a response.status of 0', t => {
	// @ts-expect-error missing Request
	const error = new ky.HTTPError(
		// Apparently, it's possible to get a response status of 0.
		createFakeResponse({statusText: undefined, status: 0})
	);

	t.is(error.message, 'Request failed with status code 0');
});
