import globals from './globals';

export const isObject = value => value !== null && typeof value === 'object';
export const supportsAbortController = typeof globals.AbortController === 'function';
export const supportsStreams = typeof globals.ReadableStream === 'function';

export const mergeHeaders = (...sources) => {
	const result = {};

	for (const source of sources) {
		if (!isObject(source)) {
			throw new TypeError('The `headers` argument must be an object');
		}

		const headers = new globals.Headers(source);

		for (const [key, value] of headers) {
			// Headers constructor changes the value to a string
			if (value === 'undefined' || typeof value === 'undefined') {
				Reflect.deleteProperty(result, key);
			} else {
				Reflect.set(result, key, value);
			}
		}
	}

	return new globals.Headers(result);
};

export const deepMerge = (...sources) => {
	let returnValue = {};
	let headers = {};

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

			if (isObject(source.headers)) {
				headers = mergeHeaders(headers, source.headers);
			}
		}

		returnValue.headers = headers;
	}

	return returnValue;
};

export const validateAndMerge = (...sources) => {
	for (const source of sources) {
		if ((!isObject(source) || Array.isArray(source)) && typeof source !== 'undefined') {
			throw new TypeError('The `options` argument must be an object');
		}
	}

	return deepMerge({}, ...sources);
};
