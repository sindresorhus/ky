import type {Expect, Equal} from '@type-challenges/utils';
import {type HttpMethod, type KyOptionsRegistry} from '../types/options.js';
import {type RequestInitRegistry} from '../types/request.js';

export const supportsRequestStreams = (() => {
	let duplexAccessed = false;
	let hasContentType = false;
	const supportsReadableStream = typeof globalThis.ReadableStream === 'function';
	const supportsRequest = typeof globalThis.Request === 'function';

	if (supportsReadableStream && supportsRequest) {
		hasContentType = new globalThis.Request('https://empty.invalid', {
			body: new globalThis.ReadableStream(),
			method: 'POST',
			// @ts-expect-error - Types are outdated.
			get duplex() {
				duplexAccessed = true;
				return 'half';
			},
		}).headers.has('Content-Type');
	}

	return duplexAccessed && !hasContentType;
})();

export const supportsAbortController = typeof globalThis.AbortController === 'function';
export const supportsResponseStreams = typeof globalThis.ReadableStream === 'function';
export const supportsFormData = typeof globalThis.FormData === 'function';

export const requestMethods = ['get', 'post', 'put', 'patch', 'head', 'delete'] as const;

const validate = <T extends Array<true>>() => undefined as unknown as T;
validate<[
	Expect<Equal<typeof requestMethods[number], HttpMethod>>,
]>();

export const responseTypes = {
	json: 'application/json',
	text: 'text/*',
	formData: 'multipart/form-data',
	arrayBuffer: '*/*',
	blob: '*/*',
} as const;

// The maximum value of a 32bit int (see issue #117)
export const maxSafeTimeout = 2_147_483_647;

export const stop = Symbol('stop');

export const kyOptionKeys: KyOptionsRegistry = {
	json: true,
	parseJson: true,
	stringifyJson: true,
	searchParams: true,
	prefixUrl: true,
	retry: true,
	timeout: true,
	hooks: true,
	throwHttpErrors: true,
	onDownloadProgress: true,
	fetch: true,
};

export const requestOptionsRegistry: RequestInitRegistry = {
	method: true,
	headers: true,
	body: true,
	mode: true,
	credentials: true,
	cache: true,
	redirect: true,
	referrer: true,
	referrerPolicy: true,
	integrity: true,
	keepalive: true,
	signal: true,
	window: true,
	dispatcher: true,
	duplex: true,
	priority: true,
};
