import type {Options} from '../types/options.js';
import {responseTypes, usualFormBoundarySize} from '../core/constants.js';
import {ResponseSizeError} from '../errors/ResponseSizeError.js';

const encoder = new TextEncoder();
const responseSizeErrors = new WeakMap<ReadableStream, () => ResponseSizeError | undefined>();
// The `Response` constructor rejects a body for these statuses, but some browsers (for example, Chromium and WebKit) still expose an empty body stream on such responses, so they must not be wrapped.
const nullBodyStatuses = new Set([101, 103, 204, 205, 304]);

// eslint-disable-next-line @typescript-eslint/no-restricted-types
export const getBodySize = (body?: BodyInit | null): number => {
	if (!body) {
		return 0;
	}

	if (body instanceof FormData) {
		// This is an approximation, as FormData size calculation is not straightforward
		let size = 0;

		for (const [key, value] of body) {
			size += usualFormBoundarySize;
			size += encoder.encode(`Content-Disposition: form-data; name="${key}"`).byteLength;
			size += typeof value === 'string'
				? encoder.encode(value).byteLength
				: value.size;
		}

		return size;
	}

	if (body instanceof Blob) {
		return body.size;
	}

	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
		return body.byteLength;
	}

	if (typeof body === 'string') {
		return encoder.encode(body).byteLength;
	}

	if (body instanceof URLSearchParams) {
		return encoder.encode(body.toString()).byteLength;
	}

	return 0;
};

const withProgress = (stream: ReadableStream<Uint8Array>, totalBytes: number, onProgress: Options['onDownloadProgress'] | Options['onUploadProgress']): ReadableStream<Uint8Array> => {
	let previousChunk: Uint8Array | undefined;
	let transferredBytes = 0;

	return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(currentChunk, controller) {
			controller.enqueue(currentChunk);

			if (previousChunk) {
				transferredBytes += previousChunk.byteLength;

				let percent = totalBytes === 0 ? 0 : transferredBytes / totalBytes;
				// Avoid reporting 100% progress before the stream is actually finished (in case totalBytes is inaccurate)
				if (percent >= 1) {
					// Epsilon is used here to get as close as possible to 100% without reaching it.
					// If we were to use 0.99 here, percent could potentially go backwards.
					percent = 1 - Number.EPSILON;
				}

				onProgress?.({percent, totalBytes: Math.max(totalBytes, transferredBytes), transferredBytes}, previousChunk);
			}

			previousChunk = currentChunk;
		},
		flush() {
			const finalChunk = previousChunk ?? new Uint8Array();
			transferredBytes += finalChunk.byteLength;
			onProgress?.({percent: 1, totalBytes: transferredBytes, transferredBytes}, finalChunk);
		},
	}));
};

const copyResponseMetadata = (response: Response, originalResponse: Response, getError = originalResponse.body ? responseSizeErrors.get(originalResponse.body) : undefined): Response => {
	const nativeClone = response.clone.bind(response);
	if (response.body && getError) {
		responseSizeErrors.set(response.body, getError);

		// Chromium replaces stream errors with a generic TypeError in native body methods.
		// Restore the size error, including on clones and download-progress wrappers.
		for (const type of Object.keys(responseTypes) as Array<keyof typeof responseTypes>) {
			if (typeof response[type] !== 'function') {
				continue;
			}

			const nativeMethod = response[type].bind(response);
			Object.defineProperty(response, type, {
				async value() {
					try {
						return await nativeMethod();
					} catch (error) {
						throw getError() ?? error;
					}
				},
				writable: true,
				configurable: true,
			});
		}
	}

	Object.defineProperties(response, {
		// The `Response` constructor cannot set these, so copy them over from the original response.
		url: {value: originalResponse.url},
		redirected: {value: originalResponse.redirected},
		type: {value: originalResponse.type},
		// Native `clone()` creates a new `Response`, which would drop them again.
		// Keep the shim replaceable like `Response.prototype.clone` for instrumentation and mocks.
		clone: {
			value() {
				const clone = nativeClone();
				// Cloning replaces the original body too, so retain the error accessor on both branches.
				if (response.body && getError) {
					responseSizeErrors.set(response.body, getError);
				}

				return copyResponseMetadata(clone, response);
			},
			writable: true,
			configurable: true,
		},
	});

	return response;
};

export const limitResponseSize = (response: Response, request: Request, maxResponseSize: number): Response => {
	if (!response.body || nullBodyStatuses.has(response.status) || maxResponseSize === Number.POSITIVE_INFINITY) {
		return response;
	}

	let transferredBytes = 0;
	let sizeError: ResponseSizeError | undefined;
	const getOriginalSizeError = responseSizeErrors.get(response.body);
	const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			transferredBytes += chunk.byteLength;
			if (transferredBytes > maxResponseSize) {
				sizeError = new ResponseSizeError(request, maxResponseSize);
				throw sizeError;
			}

			controller.enqueue(chunk);
		},
	}));

	return copyResponseMetadata(new Response(body, response), response, () => sizeError ?? getOriginalSizeError?.());
};

export const streamResponse = (response: Response, onDownloadProgress: Options['onDownloadProgress']) => {
	if (!response.body || nullBodyStatuses.has(response.status)) {
		return response;
	}

	const totalBytes = Math.max(0, Number(response.headers.get('content-length')) || 0);
	const body = withProgress(response.body, totalBytes, onDownloadProgress);

	return copyResponseMetadata(new Response(body, response), response);
};

// eslint-disable-next-line @typescript-eslint/no-restricted-types
export const streamRequest = (request: Request, onUploadProgress: Options['onUploadProgress'], originalBody?: BodyInit | null) => {
	if (!request.body || request.keepalive || request.mode === 'no-cors') {
		return request;
	}

	// Use original body for size calculation since request.body is already a stream
	const totalBytes = getBodySize(originalBody ?? request.body);

	return new Request(request, {
		// @ts-expect-error - Types are outdated.
		duplex: 'half',
		body: withProgress(request.body, totalBytes, onUploadProgress),
		// Bun drops the content type derived from a `FormData` body when the body is replaced, unless the headers are passed explicitly.
		headers: request.headers,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy,
	});
};
