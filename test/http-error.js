import http from 'http';
import test from 'ava';
import ky from '..';

function createFakeResponse({status, statusText}) {
	// The request is only used to set some response defaults.
	const request = http.request('http://example.com');
	const response = new http.ServerResponse(request);
	response.end();

	response.status = status;
	response.statusText = statusText;

	return response;
}

test('HTTPError handles undefined response.statusText', t => {
	const status = 500;
	const error = new ky.HTTPError(
		// This simulates the case where a browser Response object does
		// not defined statusText, such as IE, Safari, etc.
		// See https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText#Browser_compatibility
		createFakeResponse({statusText: undefined, status})
	);

	t.is(error.message, String(status));
});

test('HTTPError handles undefined response.status', t => {
	const error = new ky.HTTPError(
		// This simulates a catastrophic case where some unexpected response
		// object was sent to HTTPError.
		createFakeResponse({statusText: undefined, status: undefined})
	);

	t.is(error.message, 'Unknown response error');
});
