import test from 'ava';
import {Response} from 'node-fetch';
import ky from '..';

function createFakeResponse({status, statusText}) {
	// Start with a realistic fetch Response.
	const response = {...new Response()};

	// Assign these values because the Response() constructor doesn't
	// support setting them to undefined.
	response.status = status;
	response.statusText = statusText;

	return response;
}

test('HTTPError handles undefined response.statusText', t => {
	const status = 500;
	const error = new ky.HTTPError(
		// This simulates the case where a browser Response object does
		// not define statusText, such as IE, Safari, etc.
		// See https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText#Browser_compatibility
		createFakeResponse({statusText: undefined, status})
	);

	t.is(error.message, String(status));
});

test('HTTPError handles undefined response.status', t => {
	const error = new ky.HTTPError(
		// This simulates a catastrophic case where some unexpected
		// response object was sent to HTTPError.
		createFakeResponse({statusText: undefined, status: undefined})
	);

	t.is(error.message, 'Unknown response error');
});

test('HTTPError handles a response.status of 0', t => {
	const error = new ky.HTTPError(
		// Apparently, it's possible to get a response status of 0.
		createFakeResponse({statusText: undefined, status: 0})
	);

	t.is(error.message, '0');
});
