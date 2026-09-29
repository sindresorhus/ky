import type {Options} from '../types/options.js';
import {responseTypes, usualFormBoundarySize} from '../core/constants.js';
import {ResponseSizeError} from '../errors/ResponseSizeError.js';

const encoder = new TextEncoder();
const responseSizeErrors = new WeakMap<ReadableStream, () => ResponseSizeError | undefined>();
// The `Response` constructor rejects a body for these statuses, but some browsers (for example, Chromium and WebKit) still expose a body stream on such responses, so they must not be wrapped. A runtime that exposes a non-empty body for one of them, such as WebKit for 205, is therefore left unlimited and without progress events.
const nullBodyStatuses = new Set([101, 103, 204, 205, 304]);

// A multipart body sends every line break in a field name or string value as CRLF, and escapes line breaks and quotes in a field name or filename.
const normalizeLineBreaks = (value: string): string => value.replaceAll(/\r\n|\r|\n/g, '\r\n');
const escapeFormDataName = (name: string): string => name.replaceAll('\n', '%0A').replaceAll('\r', '%0D').replaceAll('"', '%22');

// eslint-disable-next-line @typescript-eslint/no-restricted-types
export const getBodySize = (body?: BodyInit | null): number => {
	if (!body) {
		return 0;
	}

	if (body instanceof FormData) {
		// This is an approximation, as FormData size calculation is not straightforward. The boundary length is a stand-in for the runtime's own, and every other byte is counted so the estimate errs high (except in Bun, see `usualFormBoundarySize`): an estimate below the real size makes `percent` reach its ceiling part way through the upload.
		let size = 0;

		for (const [key, value] of body) {
			size += usualFormBoundarySize + 4; // `--<boundary>\r\n`
			size += encoder.encode(`Content-Disposition: form-data; name="${escapeFormDataName(normalizeLineBreaks(key))}"`).byteLength;

			if (value instanceof Blob) {
				// Most runtimes turn an appended `Blob` into a `File` named `blob`, but Bun keeps a `Blob` with an `undefined` name and sends an empty filename.
				size += encoder.encode(`; filename="${escapeFormDataName((value as Partial<File>).name ?? '')}"`).byteLength;
				size += encoder.encode(`\r\nContent-Type: ${value.type || 'application/octet-stream'}`).byteLength;
			}

			size += 4; // The CRLF that ends the headers, plus the blank line.
			size += typeof value === 'string'
				? encoder.encode(normalizeLineBreaks(value)).byteLength
				: value.size;
			size += 2; // The CRLF that ends the part.
		}

		// The closing `--<boundary>--\r\n`. An empty `FormData` still sends it, but reports `0`, the documented total for an empty transfer.
		return size === 0 ? 0 : size + usualFormBoundarySize + 6;
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

				// An unknown total stays `0`, matching the `percent` computed from the same estimate and the documented progress shape.
				const reportedTotalBytes = totalBytes === 0 ? 0 : Math.max(totalBytes, transferredBytes);
				onProgress?.({percent, totalBytes: reportedTotalBytes, transferredBytes}, previousChunk);
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
		// The constructor also rebuilds the header list under the mutable "response" guard, so a network response that arrived immutable would silently become mutable. Reusing the original's headers keeps the guard; a clone shares that same object, which the spec would have copied, but copying it would drop the guard again.
		headers: {value: originalResponse.headers},
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

// The body of a response the two wrappers below can pipe through, or `undefined` when they must leave it alone. A body an `afterResponse` hook already read, or locked with a reader, would otherwise fail with "The ReadableStream is locked" instead of the native "Body is unusable" error that names the actual mistake. A null body status cannot be given a replacement body at all, and there is nothing left to report once the body is gone.
const wrappableBody = (response: Response): ReadableStream<Uint8Array> | undefined => {
	const {body} = response;
	if (!body || response.bodyUsed || body.locked || nullBodyStatuses.has(response.status)) {
		return undefined;
	}

	return body;
};

export const limitResponseSize = (response: Response, request: Request, maxResponseSize: number): Response => {
	const originalBody = wrappableBody(response);
	if (!originalBody || maxResponseSize === Number.POSITIVE_INFINITY) {
		return response;
	}

	let transferredBytes = 0;
	let sizeError: ResponseSizeError | undefined;
	const getOriginalSizeError = responseSizeErrors.get(originalBody);
	const body = originalBody.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
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
	// A response with no wrappable body is not streamed, so it reports no progress. That covers a null body status, and a `HEAD` response in runtimes that give it no body.
	const originalBody = wrappableBody(response);
	if (!originalBody) {
		return response;
	}

	// `content-length` counts encoded bytes on the wire, while the progress stream counts the bytes after decompression. Using it for a content-coded response would report a total below what actually arrives, so every event would sit at ~100%. The total is then unknown, which `Progress` already models with `0`. `identity` is a registered no-op coding (RFC 9110 §8.4.2), so it leaves the length valid.
	const contentEncoding = response.headers.get('content-encoding')?.toLowerCase();
	const isContentCoded = Boolean(contentEncoding) && contentEncoding !== 'identity';
	const totalBytes = isContentCoded ? 0 : Math.max(0, Number(response.headers.get('content-length')) || 0);
	const body = withProgress(originalBody, totalBytes, onDownloadProgress);

	return copyResponseMetadata(new Response(body, response), response);
};

// eslint-disable-next-line @typescript-eslint/no-restricted-types
export const streamRequest = (request: Request, onUploadProgress: Options['onUploadProgress'], originalBody?: BodyInit | null) => {
	// A Request-like object from a hook is used as-is, because the `Request` constructor cannot copy it. It would stringify the object as a URL here, so progress reporting is skipped for it. A body a hook already read, or locked with a reader, is left alone for the same reason as a response body: the runtime's own error names the actual mistake, where piping it would fail with "The ReadableStream is locked".
	if (
		!request.body
		|| request.bodyUsed
		|| request.body.locked
		|| request.keepalive
		|| request.mode === 'no-cors'
		|| !(request instanceof globalThis.Request)
	) {
		return request;
	}

	// Use original body for size calculation since request.body is already a stream. A `ReadableStream` measures 0, so fall back to a `content-length` the caller declared. Browsers drop that header from a request, so this only helps outside browsers.
	const totalBytes = getBodySize(originalBody ?? request.body)
		|| Math.max(0, Number(request.headers.get('content-length')) || 0);

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
