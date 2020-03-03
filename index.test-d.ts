import {expectType} from 'tsd';
import ky, {ResponsePromise, DownloadProgress, Options, NormalizedOptions, Input} from '.';

const url = 'https://sindresorhus';

// Test Ky
expectType<ResponsePromise>(ky(url));

const requestMethods = [
	'get',
	'post',
	'put',
	'delete',
	'patch',
	'head',
] as const;

// Test Ky HTTP methods
for (const method of requestMethods) {
	expectType<ResponsePromise>(ky[method](url));
	ky(url, {method});
}

expectType<typeof ky>(ky.create({}));
expectType<typeof ky>(ky.extend({}));
expectType<InstanceType<typeof ky.HTTPError>>(new ky.HTTPError(new Response()));
expectType<InstanceType<typeof ky.TimeoutError>>(new ky.TimeoutError());

ky(url, {
	hooks: {
		beforeRequest: [
			(request, options) => {
				expectType<Request>(request);
				expectType<NormalizedOptions>(options);
				request.headers.set('foo', 'bar');
			},
			(_request, _options) => {
				return new Request('Test');
			},
			async (_request, _options) => {
				return new Request('Test');
			},
			(_request, _options) => {
				return new Response('Test');
			},
			async (_request, _options) => {
				return new Response('Test');
			}
		],
		beforeRetry: [
			({request, response, options, error, retryCount}) => {
				expectType<Request>(request);
				expectType<Response>(response);
				expectType<NormalizedOptions>(options);
				expectType<Error>(error);
				expectType<number>(retryCount);
				request.headers.set('foo', 'bar');
			}
		],
		afterResponse: [
			(request, options, response) => {
				expectType<Request>(request);
				expectType<NormalizedOptions>(options);
				expectType<Response>(response);
			},
			(_request, _options, _response) => {
				return new Response('Test');
			},
			async (_request, _options, _response) => {
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

// Extending Ky
interface CustomOptions extends Options {
	foo?: boolean;
}
async function customKy(input: Input, options?: CustomOptions) {
	if (options && options.foo) {
		options.json = {foo: options.foo};
	}
	return ky(input, options);
}
customKy(input, options);

// `searchParams` option
ky(url, {searchParams: 'foo=bar'});
ky(url, {searchParams: {foo: 'bar'}});
ky(url, {searchParams: {foo: 1}});
ky(url, {searchParams: {foo: true}});
ky(url, {searchParams: [['foo', 'bar']]});
ky(url, {searchParams: [['foo', 1]]});
ky(url, {searchParams: [['foo', true]]});
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

// `retry` option
ky(url, {retry: 100});
ky(url, {
	retry: {
		methods: [],
		statusCodes: [],
		afterStatusCodes: []
	}
});

try {
	await ky.get(url);
} catch (error) {
	if (error instanceof ky.HTTPError) {
		expectType<ky.HTTPError>(error);
		const {status} = error.response;
		expectType<number>(status);
	} else if (error instanceof ky.TimeoutError) {
		expectType<ky.TimeoutError>(error);
	} else {
		throw error;	
	}
}
