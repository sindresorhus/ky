import type {Options} from '../types/options.js';
import {usualFormBoundarySize} from '../core/constants.js';

// eslint-disable-next-line @typescript-eslint/ban-types
export const getBodySize = (body?: BodyInit | null): number => {
	if (!body) {
		return 0;
	}

	if (body instanceof FormData) {
		// This is an approximation, as FormData size calculation is not straightforward
		let size = 0;

		for (const [key, value] of body) {
			size += usualFormBoundarySize;
			size += new TextEncoder().encode(`Content-Disposition: form-data; name="${key}"`).length;
			size += typeof value === 'string'
				? new TextEncoder().encode(value).length
				: value.size;
		}

		return size;
	}

	if (body instanceof Blob) {
		return body.size;
	}

	if (body instanceof ArrayBuffer) {
		return body.byteLength;
	}

	if (typeof body === 'string') {
		return new TextEncoder().encode(body).length;
	}

	if (body instanceof URLSearchParams) {
		return new TextEncoder().encode(body.toString()).length;
	}

	if ('byteLength' in body) {
		return (body).byteLength;
	}

	if (typeof body === 'object' && body !== null) {
		try {
			const jsonString = JSON.stringify(body);
			return new TextEncoder().encode(jsonString).length;
		} catch {
			return 0;
		}
	}

	return 0; // Default case, unable to determine size
};

export const streamResponse = (response: Response, onDownloadProgress: Options['onDownloadProgress']) => {
	const totalBytes = Number(response.headers.get('content-length')) || 0;
	const reader = (response.body ?? new Response('').body!).getReader();
	let transferredBytes = 0;
	let previousChunk: Uint8Array<ArrayBuffer> | undefined;

	if (response.status === 204) {
		onDownloadProgress?.({percent: 1, totalBytes, transferredBytes}, new Uint8Array());

		return new Response(
			null,
			{
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			},
		);
	}

	return new Response(
		new ReadableStream({
			cancel() {
				reader.releaseLock();
			},
			async pull(controller) {
				const {value, done} = await reader.read();

				if (previousChunk) {
					transferredBytes += previousChunk.byteLength;

					let percent = totalBytes === 0 ? 0 : transferredBytes / totalBytes;
					if (!done && percent >= 1) {
						percent = 0.99;
					}

					onDownloadProgress?.({percent: Math.min(1, Number(percent.toFixed(2))), transferredBytes, totalBytes: Math.max(totalBytes, transferredBytes)}, previousChunk);
				}

				if (done) {
					controller.close();
					return;
				}

				controller.enqueue(value);
				previousChunk = value;
			},
		}),
		{
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		},
	);
};

// eslint-disable-next-line @typescript-eslint/ban-types
export const streamRequest = (request: Request, onUploadProgress: Options['onUploadProgress'], originalBody?: BodyInit | null) => {
	// Use original body for size calculation since request.body is already a stream
	const totalBytes = getBodySize(originalBody ?? request.body);
	const reader = (request.body ?? new Response('').body!).getReader();
	let transferredBytes = 0;
	let previousChunk: Uint8Array<ArrayBuffer> | undefined;

	return new Request(request, {
		// @ts-expect-error - Types are outdated.
		duplex: 'half',
		body: new ReadableStream({
			cancel() {
				reader.releaseLock();
			},
			async pull(controller) {
				const {value, done} = await reader.read();

				if (previousChunk) {
					transferredBytes += previousChunk.byteLength;

					let percent = totalBytes === 0 ? 0 : transferredBytes / totalBytes;
					if (!done && percent >= 1) {
						percent = 0.99;
					}

					onUploadProgress?.({percent: Math.min(1, Number(percent.toFixed(2))), transferredBytes, totalBytes: Math.max(totalBytes, transferredBytes)}, previousChunk);
				}

				if (done) {
					controller.close();
					return;
				}

				controller.enqueue(value);
				previousChunk = value;
			},
		}),
	});
};
