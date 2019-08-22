import {expectType} from 'tsd';
import ky, {HTTPError, TimeoutError, ResponsePromise, DownloadProgress, Options, Input} from '.';

const url = 'https://sindresorhus';

// Test Ky
expectType<ResponsePromise>(ky(url));

const requestMethods = [
	'get',
	'head',
	'post',
	'put',
	'delete',
	'connect',
	'options',
	'trace',
	'patch',
] as const;

// Test Ky HTTP methods
for (const method of requestMethods) {
	expectType<ResponsePromise>(ky[method](url));
	ky(url, {method});
}

expectType<typeof ky>(ky.create({}));
expectType<typeof ky>(ky.extend({}));
expectType<HTTPError>(new HTTPError(new Response));
expectType<TimeoutError>(new TimeoutError);

ky(url, {
	hooks: {
		beforeRequest: [
			options => {
				expectType<Object>(options);
				options.headers.set('foo', 'bar');
			}
		],
		afterResponse: [
			response => {
				expectType<Response>(response);
				return new Response('Test');
			}
		]
	}
});

ky(new URL(url));
ky(new Request(url));

// Reusable types
const input: Input = new URL('https://sindresorhus');
const options: Options = {
	method: 'get',
	timeout: 5000,
}
ky(input, options);

// Extending ky
interface CustomOptions extends Options {
	foo?: boolean;
}
async function customKy(input: Input, options?: CustomOptions) {
	if (options && options.foo) {
		options.json = { foo: options.foo };
	}
	return ky(input, options);
}
customKy(input, options);

// `searchParams` option
ky(url, {searchParams: 'foo=bar'});
ky(url, {searchParams: {foo: 'bar'}});
ky(url, {searchParams: {foo: 1}});
ky(url, {searchParams: new URLSearchParams({foo: 'bar'})});

// `json` option
ky.post(url, {
	json: {
		foo: true
	}
});
ky.post(url, {
	json: 'x'
});

expectType<Promise<unknown>>(ky(url).json());

interface Result {
	value: number;
}
expectType<Promise<Result>>(ky(url).json<Result>());

// `onDownloadProgress` option
ky(url, {
	onDownloadProgress: (progress, chunk) => {
		expectType<DownloadProgress>(progress);
		expectType<Uint8Array>(chunk);
	}
});
