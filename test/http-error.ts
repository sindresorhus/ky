import test from 'ava';
import {expectTypeOf} from 'expect-type';
import ky, {HTTPError} from '../source/index.js';
import {type Mutable} from '../source/utils/types.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

function createFakeResponse({status, statusText}: {status?: number; statusText?: string}): Response {
	// Start with a realistic fetch Response.
	const response: Partial<Mutable<Response>> = {...new Response()};

	response.status = status;
	response.statusText = statusText;

	return response as Response;
}

test('HTTPError handles undefined response.statusText', t => {
	const status = 500;
	// @ts-expect-error missing options
	const error = new HTTPError(
		// This simulates the case where a browser Response object does
		// not define statusText, such as IE, Safari, etc.
		// See https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText#Browser_compatibility
		createFakeResponse({statusText: undefined, status}),
		new Request('invalid:foo'),
	);

	t.is(error.message, 'Request failed with status code 500: GET invalid:foo');
});

test('HTTPError handles undefined response.status', t => {
	// @ts-expect-error missing options
	const error = new HTTPError(
		// This simulates a catastrophic case where some unexpected
		// response object was sent to HTTPError.
		createFakeResponse({statusText: undefined, status: undefined}),
		new Request('invalid:foo'),
	);

	t.is(error.message, 'Request failed with an unknown error: GET invalid:foo');
});

test('HTTPError handles a response.status of 0', t => {
	// @ts-expect-error missing options
	const error = new HTTPError(
		// Apparently, it's possible to get a response status of 0.
		createFakeResponse({statusText: undefined, status: 0}),
		new Request('invalid:foo'),
	);

	t.is(error.message, 'Request failed with status code 0: GET invalid:foo');
});

test('HTTPError provides response.json()', async t => {
	// @ts-expect-error missing options
	const error = new HTTPError<{foo: 'bar'}>(
		new Response(JSON.stringify({foo: 'bar'})),
		new Request('invalid:foo'),
	);

	expectTypeOf(error.data).toEqualTypeOf<{foo: 'bar'} | string | undefined>();

	const responseJson = await error.response.json();

	expectTypeOf(responseJson).toEqualTypeOf<{foo: 'bar'}>();

	t.true(error.response instanceof Response);
	t.deepEqual(responseJson, {foo: 'bar'});
});

test('HTTPError#data is populated with parsed JSON', async t => {
	const server = await createHttpTestServer(t);
	const body = {error: 'not found', code: 42};
	server.get('/', (_request, response) => {
		response.status(404).json(body);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url));
	t.deepEqual(error?.data, body);
});

test('HTTPError#data is populated with text for non-JSON', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(500).type('text/plain').send('Internal failure');
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	t.is(error?.data, 'Internal failure');
});

test('HTTPError#data is undefined for empty body', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(404).end();
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url));
	t.is(error?.data, undefined);
});

test('HTTPError#data is undefined when JSON parse fails', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(500).type('application/json').send('not json');
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	t.is(error?.data, undefined);
});

test('HTTPError#data respects parseJson option', async t => {
	const server = await createHttpTestServer(t);
	const body = {value: 1};
	server.get('/', (_request, response) => {
		response.status(400).json(body);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {
		parseJson(text) {
			const data = JSON.parse(text) as Record<string, unknown>;
			data.custom = true;
			return data;
		},
	}));
	t.deepEqual(error?.data, {value: 1, custom: true});
});

test('HTTPError#data awaits async parseJson option', async t => {
	const server = await createHttpTestServer(t);
	const body = {value: 1};
	server.get('/', (_request, response) => {
		response.status(400).json(body);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {
		async parseJson(text) {
			await Promise.resolve();
			const data = JSON.parse(text) as Record<string, unknown>;
			data.custom = true;
			return data;
		},
	}));
	t.deepEqual(error?.data, {value: 1, custom: true});
});

test('HTTPError#data is undefined when async parseJson rejects', async t => {
	const server = await createHttpTestServer(t);
	const body = {value: 1};
	server.get('/', (_request, response) => {
		response.status(400).json(body);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {
		async parseJson() {
			throw new Error('custom parse failure');
		},
	}));
	t.true(error instanceof HTTPError);
	t.is(error?.data, undefined);
});

test('HTTPError#data does not hang when async parseJson never resolves', async t => {
	const customFetch: typeof fetch = async () => new Response('{"error":"parse-timeout"}', {
		status: 500,
		headers: {'content-type': 'application/json'},
	});

	const start = Date.now();
	const error = await t.throwsAsync<HTTPError>(ky('https://example.com', {
		fetch: customFetch,
		retry: 0,
		timeout: 500,
		parseJson: async () => new Promise<never>(resolve => {
			void resolve;
		}),
	}));
	t.true(error instanceof HTTPError);
	t.is(error?.data, undefined);
	t.true(Date.now() - start < 5000);
});

test('HTTPError#data does not call parseJson for non-JSON responses', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(400).type('text/plain').send('plain text');
	});

	let didCallParseJson = false;
	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {
		retry: 0,
		parseJson() {
			didCallParseJson = true;
			return {shouldNot: 'run'};
		},
	}));

	t.false(didCallParseJson);
	t.is(error?.data, 'plain text');
});

test('HTTPError#data is available in beforeError hooks', async t => {
	const server = await createHttpTestServer(t);
	const body = {reason: 'bad request'};
	server.get('/', (_request, response) => {
		response.status(400).json(body);
	});

	let hookData: unknown;
	await t.throwsAsync(ky.get(server.url, {
		hooks: {
			beforeError: [
				({error}) => {
					hookData = error.data;
					return error;
				},
			],
		},
	}));
	t.deepEqual(hookData, body);
});

test('HTTPError#data handles non-standard JSON content types', async t => {
	const server = await createHttpTestServer(t);
	const body = {type: 'https://example.com/not-found', title: 'Not Found', status: 404};
	server.get('/', (_request, response) => {
		response.status(404).type('application/problem+json').send(JSON.stringify(body));
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url));
	t.deepEqual(error?.data, body);
});

test('HTTPError#data parses JSON for case-insensitive content types', async t => {
	const server = await createHttpTestServer(t);
	const body = {error: 'case-insensitive'};
	server.get('/', (_request, response) => {
		response.status(400).set('content-type', 'Application/JSON; Charset=UTF-8').send(JSON.stringify(body));
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	t.deepEqual(error?.data, body);
});

test('HTTPError#data does not parse non-JSON content types with json parameters', async t => {
	const server = await createHttpTestServer(t);
	const body = '{"error":"plain text"}';
	server.get('/', (_request, response) => {
		response.status(400).set('content-type', 'text/plain; note=json').send(body);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	t.is(error?.data, body);
});

test('HTTPError#data is text for JSON-like but non-JSON media types', async t => {
	const server = await createHttpTestServer(t);
	const body = '{"error":"sequence"}';
	server.get('/', (_request, response) => {
		response.status(400).set('content-type', 'application/json-seq').send(body);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	t.is(error?.data, body);
});

test('HTTPError#data is text for HTML error pages', async t => {
	const server = await createHttpTestServer(t);
	const html = '<html><body>Bad Gateway</body></html>';
	server.get('/', (_request, response) => {
		response.status(502).type('text/html').send(html);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	t.is(error?.data, html);
});

test('HTTPError#data is text when no content-type header', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.removeHeader('content-type');
		response.status(500).end('plain error');
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	t.is(error?.data, 'plain error');
});

test('HTTPError#data decodes stream text using response charset when provided', async t => {
	const customFetch: typeof fetch = async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(Uint8Array.from([0x63, 0x61, 0x66, 0xE9]));
				controller.close();
			},
		});

		return new Response(body, {
			status: 500,
			headers: {'content-type': 'text/plain; charset=iso-8859-1'},
		});
	};

	const error = await t.throwsAsync<HTTPError>(ky('https://example.com', {
		fetch: customFetch,
		retry: 0,
		timeout: 500,
	}));
	t.is(error?.data, 'café');
});

test('HTTPError#data falls back to response.text() when response.body is null', async t => {
	const body = {error: 'streamless'};
	const customFetch: typeof fetch = async () => {
		const response = new Response(JSON.stringify(body), {
			status: 500,
			headers: {'content-type': 'application/json'},
		});

		Object.defineProperty(response, 'body', {
			get() {
				return null;
			},
		});

		return response;
	};

	const error = await t.throwsAsync<HTTPError>(ky('https://example.com', {
		fetch: customFetch,
		retry: 0,
	}));
	t.deepEqual(error?.data, body);
});

test('HTTPError#data is preserved for slow error bodies when timeout is disabled', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(500).type('application/json');
		response.write('{"error":"');
		setTimeout(() => {
			response.end('slow"}');
		}, 1100);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {
		retry: 0,
		timeout: false,
	}));
	t.deepEqual(error?.data, {error: 'slow'});
});

test('HTTPError#data is preserved for slow error bodies when timeout is greater than 1 second', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(500).type('application/json');
		response.write('{"error":"');
		setTimeout(() => {
			response.end('slow"}');
		}, 1100);
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {
		retry: 0,
		timeout: 2000,
	}));
	t.deepEqual(error?.data, {error: 'slow'});
});

test('response body is consumed after HTTPError is thrown', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(500).json({error: 'fail'});
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	t.true(error?.response.bodyUsed);
});

test('HTTPError response body readers throw after data is populated', async t => {
	const server = await createHttpTestServer(t);
	server.get('/', (_request, response) => {
		response.status(500).json({error: 'fail'});
	});

	const error = await t.throwsAsync<HTTPError>(ky.get(server.url, {retry: 0}));
	await t.throwsAsync(error!.response.json());
});

test('HTTPError does not hang on never-ending error response body when timeout is configured', async t => {
	const customFetch: typeof fetch = async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"error":"partial"'));
			},
		});

		return new Response(body, {
			status: 500,
			headers: {'content-type': 'application/json'},
		});
	};

	const start = Date.now();
	const error = await t.throwsAsync<HTTPError>(ky('https://example.com', {
		fetch: customFetch,
		retry: 0,
		timeout: 50,
	}));
	t.true(error instanceof HTTPError);
	t.is(error?.data, undefined);
	t.true(Date.now() - start < 2000);
});

test('HTTPError timeout path cancels never-ending stream reader', async t => {
	let didCancel = false;
	const customFetch: typeof fetch = async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"error":"partial"'));
			},
			cancel() {
				didCancel = true;
			},
		});

		return new Response(body, {
			status: 500,
			headers: {'content-type': 'application/json'},
		});
	};

	const error = await t.throwsAsync<HTTPError>(ky('https://example.com', {
		fetch: customFetch,
		retry: 0,
		timeout: 50,
	}));
	t.true(error instanceof HTTPError);
	t.is(error?.data, undefined);
	await new Promise(resolve => {
		setTimeout(resolve, 0);
	});
	t.true(didCancel);
});

test('HTTPError#data is undefined when error response body exceeds max size', async t => {
	const customFetch: typeof fetch = async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(11 * 1024 * 1024));
				controller.close();
			},
		});

		return new Response(body, {
			status: 500,
			headers: {'content-type': 'text/plain'},
		});
	};

	const error = await t.throwsAsync<HTTPError>(ky('https://example.com', {
		fetch: customFetch,
		retry: 0,
		timeout: 500,
	}));
	t.true(error instanceof HTTPError);
	t.is(error?.data, undefined);
});

test('HTTPError does not throw TypeError when error response stream is already locked', async t => {
	const customFetch: typeof fetch = async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"error":"locked"}'));
			},
		});

		return new Response(body, {
			status: 500,
			headers: {'content-type': 'application/json'},
		});
	};

	const error = await t.throwsAsync<HTTPError>(ky('https://example.com', {
		fetch: customFetch,
		retry: 0,
		timeout: false,
		hooks: {
			afterResponse: [
				({response}) => {
					void response.text();
					return response;
				},
			],
		},
	}));

	t.true(error instanceof HTTPError);
	t.is(error?.data, undefined);
});

test('never-ending error response body still respects total timeout budget', async t => {
	let requestCount = 0;

	const customFetch: typeof fetch = async () => {
		requestCount++;
		if (requestCount === 1) {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"error":"partial"'));
				},
			});

			return new Response(body, {
				status: 500,
				headers: {'content-type': 'application/json'},
			});
		}

		return new Response('ok');
	};

	const start = Date.now();
	const error = await t.throwsAsync(ky('https://example.com', {
		fetch: customFetch,
		retry: {
			limit: 1,
			delay: () => 0,
		},
		timeout: 1000,
	}).text());
	t.is(error?.name, 'TimeoutError');
	t.is(requestCount, 1);
	t.true(Date.now() - start < 3000);
});
