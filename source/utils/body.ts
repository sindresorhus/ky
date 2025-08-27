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
	let transferredBytes = 0;

	if (response.status === 204) {
		if (onDownloadProgress) {
			onDownloadProgress({percent: 1, totalBytes, transferredBytes}, new Uint8Array());
		}

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
			async start(controller) {
				const reader = response.body!.getReader();

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
					await read();
				}

				await read();
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
	let transferredBytes = 0;

	return new Request(request, {
		// @ts-expect-error - Types are outdated.
		duplex: 'half',
		body: new ReadableStream({
			async start(controller) {
				const reader = request.body instanceof ReadableStream ? request.body.getReader() : new Response('').body!.getReader();

				async function read() {
					const {done, value} = await reader.read();
					if (done) {
						// Ensure 100% progress is reported when the upload is complete
						if (onUploadProgress) {
							onUploadProgress({percent: 1, transferredBytes, totalBytes: Math.max(totalBytes, transferredBytes)}, new Uint8Array());
						}

						controller.close();
						return;
					}

					transferredBytes += value.byteLength;
					let percent = totalBytes === 0 ? 0 : transferredBytes / totalBytes;
					if (totalBytes < transferredBytes || percent === 1) {
						percent = 0.99;
					}

					if (onUploadProgress) {
						onUploadProgress({percent: Number(percent.toFixed(2)), transferredBytes, totalBytes}, value);
					}

					controller.enqueue(value);
					await read();
				}

				await read();
			},
		}),
	});
};
