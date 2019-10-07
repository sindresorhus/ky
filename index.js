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
const supportsAbortController = typeof globals.AbortController === 'function';
const supportsStreams = typeof globals.ReadableStream === 'function';
const supportsFormData = typeof globals.FormData === 'function';

const deepMerge = (...sources) => {
	let returnValue = {};

	for (const source of sources) {
		if (Array.isArray(source)) {
			if (!(Array.isArray(returnValue))) {
				returnValue = [];
			}

			returnValue = [...returnValue, ...source];
		} else if (isObject(source)) {
			for (let [key, value] of Object.entries(source)) {
				if (isObject(value) && Reflect.has(returnValue, key)) {
					value = deepMerge(returnValue[key], value);
				}

				returnValue = {...returnValue, [key]: value};
			}
		}
	}

	return returnValue;
};

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

const retryMethods = new Set([
	'get',
	'put',
	'head',
	'delete',
	'options',
	'trace'
]);

const retryStatusCodes = new Set([
	408,
	413,
	429,
	500,
	502,
	503,
	504
]);

const retryAfterStatusCodes = new Set([
	413,
	429,
	503
]);

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
			if (abortController) {
				abortController.abort();
			}

			reject(new TimeoutError());
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

const normalizeRequestMethod = input => requestMethods.includes(input) ? input.toUpperCase() : input;

const defaultRetryOptions = {
	limit: 2,
	methods: retryMethods,
	statusCodes: retryStatusCodes,
	afterStatusCodes: retryAfterStatusCodes
};

const normalizeRetryOptions = retry => {
	if (typeof retry === 'number') {
		return {
			...defaultRetryOptions,
			limit: retry
		};
	}

	if (retry.methods && !Array.isArray(retry.methods)) {
		throw new Error('retry.methods must be an array');
	}

	if (retry.statusCodes && !Array.isArray(retry.statusCodes)) {
		throw new Error('retry.statusCodes must be an array');
	}

	return {
		...defaultRetryOptions,
		...retry,
		methods: retry.methods ? new Set(retry.methods) : defaultRetryOptions.methods,
		statusCodes: retry.statusCodes ? new Set(retry.statusCodes) : defaultRetryOptions.statusCodes,
		afterStatusCodes: retryAfterStatusCodes
	};
};

const assertSafeTimeout = timeout => {
	if (timeout > 2147483647) { // The maximum value of a 32bit int (see issue #117)
		throw new RangeError('The `timeout` option cannot be greater than 2147483647');
	}
};

class Ky {
	constructor(input, {
		hooks,
		json,
		onDownloadProgress,
		prefixUrl,
		retry = {},
		searchParams,
		throwHttpErrors = true,
		timeout = 10000,
		...fetchOptions
	}) {
		this._retryCount = 0;
		this._input = input;
		this._options = {
			hooks: deepMerge({
				beforeRequest: [],
				beforeRetry: [],
				afterResponse: []
			}, hooks),
			json,
			onDownloadProgress,
			prefixUrl: String(prefixUrl || ''),
			retry: normalizeRetryOptions(retry),
			searchParams,
			throwHttpErrors,
			timeout
		};
		this._fetchOptions = {
			// TODO: credentials can be removed when the spec change is implemented in all browsers. Context: https://www.chromestatus.com/feature/4539473312350208
			credentials: this._input.credentials || 'same-origin',
			...fetchOptions,
			method: normalizeRequestMethod(fetchOptions.method || this._input.method)
		};

		if (typeof input !== 'string' && !(input instanceof URL || input instanceof globals.Request)) {
			throw new TypeError('`input` must be a string, URL, or Request');
		}

		if (this._options.prefixUrl && typeof this._input === 'string') {
			if (this._input.startsWith('/')) {
				throw new Error('`input` must not begin with a slash when using `prefixUrl`');
			}

			if (!this._options.prefixUrl.endsWith('/')) {
				this._options.prefixUrl += '/';
			}

			this._input = this._options.prefixUrl + this._input;
		}

		if (supportsAbortController) {
			this.abortController = new globals.AbortController();
			if (this._fetchOptions.signal) {
				this._fetchOptions.signal.addEventListener('abort', () => {
					this.abortController.abort();
				});
				this._fetchOptions.signal = this.abortController.signal;
			}
		}

		this.request = new globals.Request(this._input, this._fetchOptions);

		if (searchParams) {
			const url = new URL(this._input.url || this._input, globals.document && globals.document.baseURI);
			if (typeof searchParams === 'string' || (URLSearchParams && searchParams instanceof URLSearchParams)) {
				url.search = searchParams;
			} else if (Object.values(searchParams).every(param => typeof param === 'number' || typeof param === 'string')) {
				url.search = new URLSearchParams(searchParams).toString();
			} else {
				throw new Error('The `searchParams` option must be either a string, `URLSearchParams` instance or an object with string and number values');
			}

			this.request = new globals.Request(url, this.request);
		}

		if (((supportsFormData && this._fetchOptions.body instanceof globals.FormData) || this._fetchOptions.body instanceof URLSearchParams) && this.request.headers.has('content-type')) {
			throw new Error(`The \`content-type\` header cannot be used with a ${this._fetchOptions.body.constructor.name} body. It will be set automatically.`);
		}

		if (this._options.json) {
			if (this._fetchOptions.body) {
				throw new Error('The `json` option cannot be used with the `body` option');
			}

			this._fetchOptions.body = JSON.stringify(json);
			this.request.headers.set('content-type', 'application/json');
			this.request = new globals.Request(this.request, {body: this._fetchOptions.body});
		}

		const fn = async () => {
			assertSafeTimeout(timeout);
			await delay(1);
			let response = await this._fetch();

			for (const hook of this._options.hooks.afterResponse) {
				// eslint-disable-next-line no-await-in-loop
				const modifiedResponse = await hook(
					this.request,
					this._fetchOptions,
					response.clone()
				);

				if (modifiedResponse instanceof globals.Response) {
					response = modifiedResponse;
				}
			}

			if (!response.ok && this._options.throwHttpErrors) {
				throw new HTTPError(response);
			}

			// If `onDownloadProgress` is passed, it uses the stream API internally
			/* istanbul ignore next */
			if (this._options.onDownloadProgress) {
				if (typeof this._options.onDownloadProgress !== 'function') {
					throw new TypeError('The `onDownloadProgress` option must be a function');
				}

				if (!supportsStreams) {
					throw new Error('Streams are not supported in your environment. `ReadableStream` is missing.');
				}

				return this._stream(response.clone(), this._options.onDownloadProgress);
			}

			return response;
		};

		const isRetriableMethod = this._options.retry.methods.has(this.request.method.toLowerCase());
		const result = isRetriableMethod ? this._retry(fn) : fn();

		for (const [type, mimeType] of Object.entries(responseTypes)) {
			result[type] = async () => {
				this.request.headers.set('accept', mimeType);
				return (await result).clone()[type]();
			};
		}

		return result;
	}

	_calculateRetryDelay(error) {
		this._retryCount++;

		if (this._retryCount < this._options.retry.limit && !(error instanceof TimeoutError)) {
			if (error instanceof HTTPError) {
				if (!this._options.retry.statusCodes.has(error.response.status)) {
					return 0;
				}

				const retryAfter = error.response.headers.get('Retry-After');
				if (retryAfter && this._options.retry.afterStatusCodes.has(error.response.status)) {
					let after = Number(retryAfter);
					if (Number.isNaN(after)) {
						after = Date.parse(retryAfter) - Date.now();
					} else {
						after *= 1000;
					}

					if (typeof this._options.retry.maxRetryAfter !== 'undefined' && after > this._options.retry.maxRetryAfter) {
						return 0;
					}

					return after;
				}

				if (error.response.status === 413) {
					return 0;
				}
			}

			const BACKOFF_FACTOR = 0.3;
			return BACKOFF_FACTOR * (2 ** (this._retryCount - 1)) * 1000;
		}

		return 0;
	}

	async _retry(fn) {
		try {
			return await fn();
		} catch (error) {
			const ms = this._calculateRetryDelay(error);
			if (ms !== 0 && this._retryCount > 0) {
				await delay(ms);

				for (const hook of this._options.hooks.beforeRetry) {
					// eslint-disable-next-line no-await-in-loop
					await hook(
						this.request,
						this._fetchOptions,
						error,
						this._retryCount,
					);
				}

				return this._retry(fn);
			}

			if (this._options.throwHttpErrors) {
				throw error;
			}
		}
	}

	async _fetch() {
		for (const hook of this._options.hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			const result = await hook(this.request, this._fetchOptions);

			if (result instanceof Request) {
				this.request = result;
				break;
			}

			if (result instanceof Response) {
				return result;
			}
		}

		if (this._options.timeout === false) {
			return globals.fetch(this.request);
		}

		return timeout(globals.fetch(this.request), this._options.timeout, this.abortController);
	}

	/* istanbul ignore next */
	_stream(response, onDownloadProgress) {
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

const validateAndMerge = (...sources) => {
	for (const source of sources) {
		if ((!isObject(source) || Array.isArray(source)) && typeof source !== 'undefined') {
			throw new TypeError('The `options` argument must be an object');
		}
	}

	return deepMerge({}, ...sources);
};

const createInstance = defaults => {
	const ky = (input, options) => new Ky(input, validateAndMerge(defaults, options));

	for (const method of requestMethods) {
		ky[method] = (input, options) => new Ky(input, validateAndMerge(defaults, options, {method}));
	}

	ky.create = newDefaults => createInstance(validateAndMerge(newDefaults));
	ky.extend = newDefaults => createInstance(validateAndMerge(defaults, newDefaults));

	return ky;
};

export default createInstance();

export {
	HTTPError,
	TimeoutError
};
