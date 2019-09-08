/*! MIT License © Sindre Sorhus */

const globals = {};

{
	const getGlobal = property => {
		let parent;

		/* istanbul ignore next */
		if (typeof self !== 'undefined' && self && property in self) {
			parent = self;
		}

		/* istanbul ignore next */
		if (typeof window !== 'undefined' && window && property in window) {
			parent = window;
		}

		if (typeof global !== 'undefined' && global && property in global) {
			parent = global;
		}

		/* istanbul ignore next */
		if (typeof globalThis !== 'undefined' && globalThis) {
			parent = globalThis;
		}

		if (typeof parent === 'undefined') {
			return;
		}

		const globalProperty = parent[property];

		if (typeof globalProperty === 'function') {
			return globalProperty.bind(parent);
		}

		return globalProperty;
	};

	const globalProperties = [
		'document',
		'Headers',
		'Request',
		'Response',
		'ReadableStream',
		'fetch',
		'AbortController',
		'FormData'
	];

	const props = {};
	for (const property of globalProperties) {
		props[property] = {
			get() {
				return getGlobal(property);
			}
		};
	}

	Object.defineProperties(globals, props);
}

const isObject = value => value !== null && typeof value === 'object';

const isPlainObject = value => {
	if (Object.prototype.toString.call(value) !== '[object Object]') {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);
	return prototype === null || prototype === Object.getPrototypeOf({});
};

const deepMerge = (target, ...sources) => {
	for (const source of sources) {
		for (const [key, sourceValue] of Object.entries(source)) {
			if (typeof sourceValue === 'undefined') {
				continue;
			}

			const targetValue = target[key];
			if (targetValue instanceof URL && (sourceValue instanceof URL || typeof sourceValue === 'string')) {
				target[key] = new URL(sourceValue, targetValue);
			} else if (isPlainObject(sourceValue)) {
				if (isPlainObject(targetValue)) {
					target[key] = deepMerge({}, targetValue, sourceValue);
				} else {
					target[key] = deepMerge({}, sourceValue);
				}
			} else if (Array.isArray(sourceValue)) {
				target[key] = deepMerge([], sourceValue);
			} else {
				target[key] = sourceValue;
			}
		}
	}

	return target;
};

const knownHookEvents = ['beforeRequest', 'afterResponse'];

const requestMethods = [
	'get',
	'post',
	'put',
	'patch',
	'head',
	'delete'
];

const responseTypes = {
	json: 'application/json',
	text: 'text/*',
	formData: 'multipart/form-data',
	arrayBuffer: '*/*',
	blob: '*/*'
};

class HTTPError extends Error {
	constructor(response) {
		super(response.statusText);
		this.name = 'HTTPError';
		this.response = response;
	}
}

class TimeoutError extends Error {
	constructor() {
		super('Request timed out');
		this.name = 'TimeoutError';
	}
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// `Promise.race()` workaround (#91)
const timeout = (promise, ms, abortController) =>
	new Promise((resolve, reject) => {
		const timeoutID = setTimeout(() => {
			reject(new TimeoutError());

			if (globals.AbortController) {
				abortController.abort();
			}
		}, ms);

		/* eslint-disable promise/prefer-await-to-then */
		promise
			.then(resolve)
			.catch(reject)
			.then(() => {
				clearTimeout(timeoutID);
			});
		/* eslint-enable promise/prefer-await-to-then */
	});

const preNormalizeOptions = (options, defaults) => {
	// Convert `searchParams` into `URLSearchParams`
	const {searchParams} = options;
	if (isObject(searchParams) && !(searchParams instanceof URLSearchParams)) {
		if (Object.values(searchParams).every(param => typeof param === 'number' || typeof param === 'string')) {
			options.searchParams = new URLSearchParams(searchParams);
		} else {
			throw new TypeError('The `searchParams` option must be either a string, `URLSearchParams` instance or an object with string and number values');
		}
	}

	// Normalize `prefixUrl`
	options.prefixUrl = String(options.prefixUrl || '');
	if (options.prefixUrl && !options.prefixUrl.endsWith('/')) {
		options.prefixUrl += '/';
	}

	// Normalize hooks
	if (!options.hooks) {
		options.hooks = {};
	} else if (!isObject(options.hooks)) {
		throw new TypeError(`Parameter \`hooks\` must be an object, not ${options.hooks.constructor.name}`);
	}

	for (const event of knownHookEvents) {
		options.hooks[event] = options.hooks[event] || [];

		if (defaults) {
			options.hooks[event] = [
				...defaults.hooks[event],
				...options.hooks[event]
			];
		}
	}

	// Check timeout
	if (options.timeout > 2147483647) { // The maximum value of a signed 32bit int (see #117)
		throw new RangeError('The `timeout` option cannot be greater than 2147483647');
	}

	// Normalize retry options
	const {retry} = options;
	options.retry = {
		retries: () => 0,
		methods: new Set(),
		statusCodes: new Set(),
		errorNames: new Set(),
		maxRetryAfter: undefined
	};

	if (defaults) {
		options.retry = {
			...options.retry,
			...defaults.retry
		};
	}

	if (retry !== false) {
		if (typeof retry === 'number') {
			options.retry.retries = retry;
		} else {
			options.retry = {...options.retry, ...retry};
		}
	}

	if (!options.retry.maxRetryAfter && options.timeout) {
		options.retry.maxRetryAfter = options.timeout;
	}

	if (Array.isArray(options.retry.methods)) {
		options.retry.methods = new Set(options.retry.methods.map(method => method.toUpperCase()));
	} else if (!(options.retry.methods instanceof Set)) {
		throw new TypeError('options.retry.methods must be either an array or a Set instance');
	}

	if (Array.isArray(options.retry.statusCodes)) {
		options.retry.statusCodes = new Set(options.retry.statusCodes);
	} else if (!(options.retry.statusCodes instanceof Set)) {
		throw new TypeError('options.retry.statusCodes must be either an array or a Set instance');
	}

	if (Array.isArray(options.retry.errorNames)) {
		options.retry.errorNames = new Set(options.retry.errorNames);
	} else if (!(options.retry.errorNames instanceof Set)) {
		throw new TypeError('options.retry.errorNames must be either an array or a Set instance');
	}
};

const normalizeOptions = (input, options) => {
	// Normalize method
	if (requestMethods.includes(options.method)) {
		options.method = options.method.toUpperCase();
	} else if (!options.method) {
		options.method = input instanceof globals.Request ? input.method : 'GET';
	}

	// Normalize headers
	const {headers} = options;
	options.headers = headers instanceof globals.Headers ? headers : new globals.Headers(headers);

	// Override search params
	const {searchParams} = options;
	if (input instanceof URL && searchParams) {
		if (typeof searchParams === 'string' || (searchParams instanceof URLSearchParams)) {
			input.search = searchParams;
		} else {
			throw new TypeError('The `searchParams` option must be either a string, `URLSearchParams` instance or an object with string and number values');
		}
	}

	// Set up the retry logic
	if (typeof options.retry.retries !== 'function') {
		const retryAfterStatusCodes = new Set([413, 429, 503]);
		const {retries} = options.retry;

		options.retry.retries = (iteration, error, options) => {
			if (iteration > retries || typeof error === 'undefined') {
				return 0;
			}

			const hasResponse = typeof error.response !== 'undefined';

			const hasError = options.retry.errorNames.has(error.name);
			const hasMethod = options.retry.methods.has(options.method);
			const hasStatusCode = hasResponse && options.retry.statusCodes.has(error.response.status);
			if (!hasError && (!hasMethod || !hasStatusCode)) {
				return 0;
			}

			if (hasResponse) {
				const retryAfter = error.response.headers.get('retry-after');
				if (retryAfter && retryAfterStatusCodes.has(error.response.status)) {
					let after = Number(retryAfter);
					if (Number.isNaN(after)) {
						after = Date.parse(retryAfter) - Date.now();
					} else {
						after *= 1000;
					}

					if (after > options.retry.maxRetryAfter) {
						return 0;
					}

					return after;
				}

				if (error.response.status === 413) {
					return 0;
				}
			}

			const BACKOFF_FACTOR = 0.3;
			return BACKOFF_FACTOR * (2 ** (iteration - 1)) * 1000;
		};
	}
};

class Ky {
	constructor(input, options = {}, defaults) {
		preNormalizeOptions(options, defaults);
		options = deepMerge({}, defaults, options);

		if (((globals.FormData && options.body instanceof globals.FormData) || options.body instanceof URLSearchParams) && Reflect.has(options.headers, 'content-type')) {
			throw new Error(`The \`content-type\` header cannot be used with a ${options.body.constructor.name} body. It will be set automatically.`);
		}

		if (!(input instanceof globals.Request)) {
			if (options.prefixUrl && typeof input === 'string' && input.startsWith('/')) {
				throw new Error('`input` must not begin with a slash when using `prefixUrl`');
			}

			input = new URL(options.prefixUrl + String(input || ''), globals.document && globals.document.baseURI);
		}

		if (globals.AbortController) {
			this.abortController = new globals.AbortController();
			if (options.signal) {
				options.signal.addEventListener('abort', () => {
					this.abortController.abort();
				});
			}

			options.signal = this.abortController.signal;
		}

		normalizeOptions(input, options);

		this.input = input;
		this.options = options;
		this.retryCount = 0;

		// Prepare a Promise
		const fn = async () => {
			await delay(1);
			let response = await this.fetch();

			for (const hook of options.hooks.afterResponse) {
				// eslint-disable-next-line no-await-in-loop
				const modifiedResponse = await hook(
					input,
					options,
					response.clone()
				);

				if (modifiedResponse instanceof globals.Response) {
					response = modifiedResponse;
				}
			}

			if (!response.ok && options.throwHttpErrors) {
				throw new HTTPError(response);
			}

			// If `onDownloadProgress` is passed, it uses the stream API internally
			/* istanbul ignore next */
			if (options.onDownloadProgress) {
				if (typeof options.onDownloadProgress !== 'function') {
					throw new TypeError('The `onDownloadProgress` option must be a function');
				}

				if (!globals.ReadableStream) {
					throw new Error('Streams are not supported in your environment. `ReadableStream` is missing.');
				}

				return this.stream(response.clone(), options.onDownloadProgress);
			}

			return response;
		};

		const result = this.retry(fn);

		for (const [type, mimeType] of Object.entries(responseTypes)) {
			result[type] = async () => {
				options.headers.set('accept', mimeType);
				return (await result).clone()[type]();
			};
		}

		return result;
	}

	async retry(fn) {
		try {
			return await fn();
		} catch (error) {
			const ms = this.options.retry.retries(++this.retryCount, error, this.options);
			if (ms !== 0) {
				await delay(ms);

				return this.retry(fn);
			}

			if (this.options.throwHttpErrors) {
				throw error;
			}
		}
	}

	async fetch() {
		for (const hook of this.options.hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			await hook(this.input, this.options);
		}

		// Normalize body
		if (this.options.json) {
			if (this.options.body) {
				throw new Error('The `json` option cannot be used with the `body` option');
			}

			this.options.headers.set('content-type', 'application/json');
			this.options.body = JSON.stringify(this.options.json);
		}

		// Normalize input
		if (this.input instanceof URL) {
			this.input = this.input.toString();
		}

		// Apply timeout if needed
		if (typeof this.options.timeout !== 'number') {
			return globals.fetch(this.input, this.options);
		}

		return timeout(globals.fetch(this.input, this.options), this.options.timeout, this.abortController);
	}

	/* istanbul ignore next */
	stream(response, onDownloadProgress) {
		const totalBytes = Number(response.headers.get('content-length')) || 0;
		let transferredBytes = 0;

		return new globals.Response(
			new globals.ReadableStream({
				start(controller) {
					const reader = response.body.getReader();

					if (onDownloadProgress) {
						onDownloadProgress({percent: 0, transferredBytes: 0, totalBytes}, new Uint8Array());
					}

					async function read() {
						const {done, value} = await reader.read();
						if (done) {
							controller.close();
							return;
						}

						if (onDownloadProgress) {
							transferredBytes += value.byteLength;
							const percent = totalBytes === 0 ? 0 : transferredBytes / totalBytes;
							onDownloadProgress({percent, transferredBytes, totalBytes}, value);
						}

						controller.enqueue(value);
						read();
					}

					read();
				}
			})
		);
	}
}

const createInstance = defaults => {
	if ((!isObject(defaults) || Array.isArray(defaults)) && typeof defaults !== 'undefined') {
		throw new TypeError('The `defaultOptions` argument must be an object');
	}

	defaults = deepMerge({}, defaults);
	preNormalizeOptions(defaults);

	const ky = (input, options) => new Ky(input, options, defaults);

	for (const method of requestMethods) {
		ky[method] = (input, options) => new Ky(input, {...options, method}, defaults);
	}

	ky.create = newDefaults => createInstance(newDefaults);
	ky.extend = newDefaults => {
		const mergedOptions = deepMerge({}, defaults, newDefaults);

		for (const hook of knownHookEvents) {
			if (newDefaults.hooks && Reflect.has(newDefaults.hooks, hook)) {
				mergedOptions.hooks[hook] = [
					...defaults.hooks[hook],
					...newDefaults.hooks[hook],
				];
			}
		}

		return createInstance(mergedOptions);
	};

	return ky;
};

export default createInstance({
	redirect: 'follow',
	credentials: 'same-origin',
	keepalive: false,
	cache: 'default',
	throwHttpErrors: true,
	timeout: 10000,
	retry: {
		retries: 2,
		methods: [
			'GET',
			'PUT',
			'HEAD',
			'DELETE',
			'OPTIONS',
			'TRACE'
		],
		statusCodes: [
			408,
			413,
			429,
			500,
			502,
			503,
			504
		],
		errorNames: [
			'TimeoutError'
		]
	},
	hooks: {
		beforeRequest: [],
		afterResponse: []
	}
});

export {
	HTTPError,
	TimeoutError
};
