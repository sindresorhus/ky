/*! MIT License © Sindre Sorhus */

const getGlobal = property => {
	/* istanbul ignore next */
	if (typeof self !== 'undefined' && self && property in self) {
		return self[property];
	}

	/* istanbul ignore next */
	if (typeof window !== 'undefined' && window && property in window) {
		return window[property];
	}

	return global[property];
};

const document = getGlobal('document');
const Headers = getGlobal('Headers');
const Response = getGlobal('Response');
const fetch = getGlobal('fetch');

const isObject = value => value !== null && typeof value === 'object';

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

const responseTypes = [
	'json',
	'text',
	'formData',
	'arrayBuffer',
	'blob'
];

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

const timeout = (promise, ms) => Promise.race([
	promise,
	(async () => {
		await delay(ms);
		throw new TimeoutError();
	})()
]);

const normalizeRequestMethod = input => requestMethods.includes(input) ? input.toUpperCase() : input;

class Ky {
	constructor(input, {
		timeout = 10000,
		hooks,
		throwHttpErrors = true,
		searchParams,
		json,
		...otherOptions
	}) {
		this._retryCount = 0;

		this._options = {
			method: 'get',
			credentials: 'same-origin', // TODO: This can be removed when the spec change is implemented in all browsers. Context: https://www.chromestatus.com/feature/4539473312350208
			retry: 2,
			...otherOptions
		};
		this._options.method = normalizeRequestMethod(this._options.method);
		this._options.prefixUrl = String(this._options.prefixUrl || '');
		this._input = String(input || '');

		if (this._options.prefixUrl && this._input.startsWith('/')) {
			throw new Error('`input` must not begin with a slash when using `prefixUrl`');
		}

		if (this._options.prefixUrl && !this._options.prefixUrl.endsWith('/')) {
			this._options.prefixUrl += '/';
		}

		this._input = this._options.prefixUrl + this._input;

		if (searchParams) {
			const url = new URL(this._input, document && document.baseURI);
			if (typeof searchParams === 'string' || (URLSearchParams && searchParams instanceof URLSearchParams)) {
				url.search = searchParams;
			} else if (Object.values(searchParams).every(param => typeof param === 'number' || typeof param === 'string')) {
				url.search = new URLSearchParams(searchParams).toString();
			} else {
				throw new Error('The `searchParams` option must be either a string, `URLSearchParams` instance or an object with string and number values');
			}

			this._input = url.toString();
		}

		this._timeout = timeout;
		this._hooks = deepMerge({
			beforeRequest: [],
			afterResponse: []
		}, hooks);
		this._throwHttpErrors = throwHttpErrors;

		const headers = new Headers(this._options.headers || {});

		if (json) {
			if (this._options.body) {
				throw new TypeError('The `json` option cannot be used with the `body` option');
			}

			headers.set('content-type', 'application/json');
			this._options.body = JSON.stringify(json);
		}

		this._options.headers = headers;

		this._response = this._fetch();

		for (const type of responseTypes) {
			const isRetriableMethod = retryMethods.has(this._options.method.toLowerCase());
			const fn = async () => {
				if (this._retryCount > 0) {
					this._response = this._fetch();
				}

				let response = await this._response;

				for (const hook of this._hooks.afterResponse) {
					// eslint-disable-next-line no-await-in-loop
					const modifiedResponse = await hook(response.clone());

					if (modifiedResponse instanceof Response) {
						response = modifiedResponse;
					}
				}

				if (!response.ok && (isRetriableMethod || this._throwHttpErrors)) {
					throw new HTTPError(response);
				}

				return response.clone()[type]();
			};

			this._response[type] = isRetriableMethod ? this._retry(fn) : fn;
		}

		return this._response;
	}

	_calculateRetryDelay(error) {
		this._retryCount++;

		if (this._retryCount < this._options.retry && !(error instanceof TimeoutError)) {
			if (error instanceof HTTPError) {
				if (!retryStatusCodes.has(error.response.status)) {
					return 0;
				}

				const retryAfter = error.response.headers.get('Retry-After');
				if (retryAfter && retryAfterStatusCodes.has(error.response.status)) {
					let after = Number(retryAfter);
					if (Number.isNaN(after)) {
						after = Date.parse(retryAfter) - Date.now();
					} else {
						after *= 1000;
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

	_retry(fn) {
		const retry = async () => {
			try {
				return await fn();
			} catch (error) {
				const ms = this._calculateRetryDelay(error);
				if (ms !== 0) {
					await delay(ms);
					return retry();
				}

				if (this._throwHttpErrors) {
					throw error;
				}
			}
		};

		return retry;
	}

	async _fetch() {
		for (const hook of this._hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			await hook(this._options);
		}

		return timeout(fetch(this._input, this._options), this._timeout);
	}
}

const createInstance = (defaults = {}) => {
	if (!isObject(defaults) || Array.isArray(defaults)) {
		throw new TypeError('The `defaultOptions` argument must be an object');
	}

	const ky = (input, options) => new Ky(input, deepMerge({}, defaults, options));

	for (const method of requestMethods) {
		ky[method] = (input, options) => new Ky(input, deepMerge({}, defaults, options, {method}));
	}

	ky.extend = defaults => createInstance(defaults);

	return ky;
};

export default createInstance();

export {
	HTTPError,
	TimeoutError
};
