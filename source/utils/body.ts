import type {Options} from '../types/options.js';
import {initialFormSize, formBoundarySize} from '../core/constants.js';

const encoder = new TextEncoder();

// eslint-disable-next-line @typescript-eslint/ban-types
export const getBodySize = (body?: BodyInit | null): number => {
	if (!body) {
		return 0;
	}

	if (body instanceof FormData) {
		let size = initialFormSize;

		for (const [key, value] of body) {
			size += formBoundarySize;
			size += encoder.encode(key).length;

			if (value instanceof Blob) {
				size += encoder.encode(`; filename="${value.name ?? 'blob'}"`).length;
				size += encoder.encode(`\r\nContent-Type: ${value.type || 'application/octet-stream'}`).length;
			}

			size += typeof value === 'string'
				? encoder.encode(value).length
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
		return encoder.encode(body).length;
	}

	if (body instanceof URLSearchParams) {
		return encoder.encode(body.toString()).length;
	}

	return 0; // Default case, unable to determine size
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
			if (previousChunk) {
				transferredBytes += previousChunk.byteLength;
				onProgress?.({percent: 1, totalBytes: Math.max(totalBytes, transferredBytes), transferredBytes}, previousChunk);
			}
		},
	}));
};

export const streamResponse = (response: Response, onDownloadProgress: Options['onDownloadProgress']) => {
	if (!response.body) {
		return response;
	}

	if (response.status === 204) {
		return new Response(
			null,
			{
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			},
		);
	}

	const totalBytes = Number(response.headers.get('content-length')) || 0;

	return new Response(
		withProgress(response.body, totalBytes, onDownloadProgress),
		{
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		},
	);
};

// eslint-disable-next-line @typescript-eslint/ban-types
export const streamRequest = (request: Request, onUploadProgress: Options['onUploadProgress'], originalBody?: BodyInit | null) => {
	if (!request.body) {
		return request;
	}

	// Use original body for size calculation since request.body is already a stream
	const totalBytes = getBodySize(originalBody ?? request.body);

	return new Request(request, {
		// @ts-expect-error - Types are outdated.
		duplex: 'half',
		body: withProgress(request.body, totalBytes, onUploadProgress),
	});
};
