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

const safeTimeout = (resolve, reject, ms) => {
	if (ms > 2147483647) { // The maximum value of a 32bit int (see #117)
		reject(new RangeError('The `timeout` option cannot be greater than 2147483647'));
	}

	return setTimeout(resolve, ms);
};

const delay = ms => new Promise((resolve, reject) => safeTimeout(resolve, reject, ms));

// `Promise.race()` workaround (#91)
const timeout = (promise, ms, abortController) =>
	new Promise((resolve, reject) => {
		const timeoutID = safeTimeout(() => {
			if (supportsAbortController) {
				abortController.abort();
			}

			reject(new TimeoutError());
		}, reject, ms);

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

class Ky {
	constructor(input, {
		timeout = 10000,
		hooks,
		throwHttpErrors = true,
		searchParams,
		json,
		retry = {},
		...otherOptions
	}) {
		this._retryCount = 0;

		this._options = {
			method: 'get',
			credentials: 'same-origin', // TODO: This can be removed when the spec change is implemented in all browsers. Context: https://www.chromestatus.com/feature/4539473312350208
			retry: normalizeRetryOptions(retry),
			...otherOptions
		};

		if (input instanceof globals.Request) {
			this._input = input;

			// `ky` options have precedence over `Request` options
			this._options = {
				...this._options,
				method: otherOptions.method || input.method,
				headers: otherOptions.headers || input.headers,
				body: otherOptions.body || input.body,
				credentials: otherOptions.credentials || input.credentials
			};
		} else {
			this._input = String(input || '');
			this._options.prefixUrl = String(this._options.prefixUrl || '');

			if (this._options.prefixUrl && this._input.startsWith('/')) {
				throw new Error('`input` must not begin with a slash when using `prefixUrl`');
			}

			if (this._options.prefixUrl && !this._options.prefixUrl.endsWith('/')) {
				this._options.prefixUrl += '/';
			}

			this._input = this._options.prefixUrl + this._input;

			if (searchParams) {
				const url = new URL(this._input, globals.document && globals.document.baseURI);
				if (typeof searchParams === 'string' || (URLSearchParams && searchParams instanceof URLSearchParams)) {
					url.search = searchParams;
				} else if (Object.values(searchParams).every(param => typeof param === 'number' || typeof param === 'string')) {
					url.search = new URLSearchParams(searchParams).toString();
				} else {
					throw new Error('The `searchParams` option must be either a string, `URLSearchParams` instance or an object with string and number values');
				}

				this._input = url.toString();
			}
		}

		if (supportsAbortController) {
			this.abortController = new globals.AbortController();
			if (this._options.signal) {
				this._options.signal.addEventListener('abort', () => {
					this.abortController.abort();
				});
			}

			this._options.signal = this.abortController.signal;
		}

		this._options.method = normalizeRequestMethod(this._options.method);

		this._timeout = timeout;
		this._hooks = deepMerge({
			beforeRequest: [],
			beforeRetry: [],
			afterResponse: []
		}, hooks);
		this._throwHttpErrors = throwHttpErrors;

		const headers = new globals.Headers(this._options.headers || {});

		if (((supportsFormData && this._options.body instanceof globals.FormData) || this._options.body instanceof URLSearchParams) && headers.has('content-type')) {
			throw new Error(`The \`content-type\` header cannot be used with a ${this._options.body.constructor.name} body. It will be set automatically.`);
		}

		if (json) {
			if (this._options.body) {
				throw new Error('The `json` option cannot be used with the `body` option');
			}

			headers.set('content-type', 'application/json');
			this._options.body = JSON.stringify(json);
		}

		this._options.headers = headers;

		const fn = async () => {
			await delay(1);
			let response = await this._fetch();

			for (const hook of this._hooks.afterResponse) {
				// eslint-disable-next-line no-await-in-loop
				const modifiedResponse = await hook(
					this._input,
					this._options,
					response.clone()
				);

				if (modifiedResponse instanceof globals.Response) {
					response = modifiedResponse;
				}
			}

			if (!response.ok && this._throwHttpErrors) {
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

		const isRetriableMethod = this._options.retry.methods.has(this._options.method.toLowerCase());
		const result = isRetriableMethod ? this._retry(fn) : fn();

		for (const [type, mimeType] of Object.entries(responseTypes)) {
			result[type] = async () => {
				headers.set('accept', mimeType);
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

				for (const hook of this._hooks.beforeRetry) {
					// eslint-disable-next-line no-await-in-loop
					await hook(
						this._input,
						this._options,
						error,
						this._retryCount,
					);
				}

				return this._retry(fn);
			}

			if (this._throwHttpErrors) {
				throw error;
			}
		}
	}

	async _fetch() {
		for (const hook of this._hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			const result = await hook(this._input, this._options);

			if (result instanceof Response) {
				return result;
			}
		}

		if (this._timeout === false) {
			return globals.fetch(this._input, this._options);
		}

		return timeout(globals.fetch(this._input, this._options), this._timeout, this.abortController);
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
