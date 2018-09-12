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

class Ky {
	constructor(input, {timeout = 10000, hooks = {beforeRequest: []}, throwHttpErrors = true, json, ...otherOptions}) {
		this._input = input;
		this._retryCount = 0;

		this._options = {
			method: 'get',
			credentials: 'same-origin', // TODO: This can be removed when the spec change is implemented in all browsers. Context: https://www.chromestatus.com/feature/4539473312350208
			retry: 3,
			...otherOptions
		};

		this._timeout = timeout;
		this._hooks = hooks;
		this._throwHttpErrors = throwHttpErrors;

		const headers = new window.Headers(this._options.headers || {});

		if (json) {
			headers.set('content-type', 'application/json');
			this._options.body = JSON.stringify(json);
		}

		this._options.headers = headers;

		this._response = this._fetch();

		for (const type of responseTypes) {
			this._response[type] = this._retry(async () => {
				if (this._retryCount > 0) {
					this._response = this._fetch();
				}

				const response = await this._response;

				if (!response.ok) {
					throw new HTTPError(response);
				}

				return response.clone()[type]();
			});
		}

		return this._response;
	}

	_retry(fn) {
		if (!retryMethods.has(this._options.method.toLowerCase())) {
			return fn;
		}

		const retry = async () => {
			try {
				return await fn();
			} catch (error) {
				const shouldRetryStatusCode = error instanceof HTTPError ? retryStatusCodes.has(error.response.status) : true;
				if (!(error instanceof TimeoutError) && shouldRetryStatusCode && this._retryCount < this._options.retry) {
					this._retryCount++;
					const BACKOFF_FACTOR = 0.3;
					const delaySeconds = BACKOFF_FACTOR * (2 ** (this._retryCount - 1));
					await delay(delaySeconds * 1000);
					return retry();
				}

				if (this._throwHttpErrors) {
					throw error;
				}
			}
		};

		return retry;
	}

	_fetch() {
		(async () => {
			for (const hook of this._hooks.beforeRequest) {
				// eslint-disable-next-line no-await-in-loop
				await hook(this._options);
			}
		})();

		return timeout(window.fetch(this._input, this._options), this._timeout);
	}
}

const createInstance = (defaults = {}) => {
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
