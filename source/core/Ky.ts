import {HTTPError} from '../errors/HTTPError.js';
import {TimeoutError} from '../errors/TimeoutError.js';
import type {
	Input,
	InternalOptions,
	NormalizedOptions,
	Options,
	SearchParamsInit,
} from '../types/options.js';
import {type ResponsePromise} from '../types/ResponsePromise.js';
import {mergeHeaders, mergeHooks} from '../utils/merge.js';
import {normalizeRequestMethod, normalizeRetryOptions} from '../utils/normalize.js';
import timeout, {type TimeoutOptions} from '../utils/timeout.js';
import delay from '../utils/delay.js';
import {type ObjectEntries} from '../utils/types.js';
import {findUnknownOptions} from '../utils/options.js';
import {
	maxSafeTimeout,
	responseTypes,
	stop,
	supportsAbortController,
	supportsFormData,
	supportsResponseStreams,
	supportsRequestStreams,
} from './constants.js';

export class Ky {
	static create(input: Input, options: Options): ResponsePromise {
		const ky = new Ky(input, options);

		const function_ = async (): Promise<Response> => {
			if (typeof ky._options.timeout === 'number' && ky._options.timeout > maxSafeTimeout) {
				throw new RangeError(`The \`timeout\` option cannot be greater than ${maxSafeTimeout}`);
			}

			// Delay the fetch so that body method shortcuts can set the Accept header
			await Promise.resolve();
			let response = await ky._fetch();

			for (const hook of ky._options.hooks.afterResponse) {
				// eslint-disable-next-line no-await-in-loop
				const modifiedResponse = await hook(
					ky.request,
					ky._options as NormalizedOptions,
					ky._decorateResponse(response.clone()),
				);

				if (modifiedResponse instanceof globalThis.Response) {
					response = modifiedResponse;
				}
			}

			ky._decorateResponse(response);

			if (!response.ok && ky._options.throwHttpErrors) {
				let error = new HTTPError(response, ky.request, ky._options as NormalizedOptions);

				for (const hook of ky._options.hooks.beforeError) {
					// eslint-disable-next-line no-await-in-loop
					error = await hook(error);
				}

				throw error;
			}

			// If `onDownloadProgress` is passed, it uses the stream API internally
			/* istanbul ignore next */
			if (ky._options.onDownloadProgress) {
				if (typeof ky._options.onDownloadProgress !== 'function') {
					throw new TypeError('The `onDownloadProgress` option must be a function');
				}

				if (!supportsResponseStreams) {
					throw new Error('Streams are not supported in your environment. `ReadableStream` is missing.');
				}

				return ky._streamResponse(response.clone(), ky._options.onDownloadProgress);
			}

			return response;
		};

		const isRetriableMethod = ky._options.retry.methods.includes(ky.request.method.toLowerCase());
		const result = (isRetriableMethod ? ky._retry(function_) : function_()) as ResponsePromise;

		for (const [type, mimeType] of Object.entries(responseTypes) as ObjectEntries<typeof responseTypes>) {
			result[type] = async () => {
				// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
				ky.request.headers.set('accept', ky.request.headers.get('accept') || mimeType);

				const awaitedResult = await result;
				const response = awaitedResult.clone();

				if (type === 'json') {
					if (response.status === 204) {
						return '';
					}

					const arrayBuffer = await response.clone().arrayBuffer();
					const responseSize = arrayBuffer.byteLength;
					if (responseSize === 0) {
						return '';
					}

					if (options.parseJson) {
						return options.parseJson(await response.text());
					}
				}

				return response[type]();
			};
		}

		return result;
	}

	public request: Request;
	protected abortController?: AbortController;
	protected _retryCount = 0;
	protected _input: Input;
	protected _options: InternalOptions;

	// eslint-disable-next-line complexity
	constructor(input: Input, options: Options = {}) {
		this._input = input;

		this._options = {
			...options,
			headers: mergeHeaders((this._input as Request).headers, options.headers),
			hooks: mergeHooks(
				{
					beforeRequest: [],
					beforeRetry: [],
					beforeError: [],
					afterResponse: [],
				},
				options.hooks,
			),
			method: normalizeRequestMethod(options.method ?? (this._input as Request).method),
			// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
			prefixUrl: String(options.prefixUrl || ''),
			retry: normalizeRetryOptions(options.retry),
			throwHttpErrors: options.throwHttpErrors !== false,
			timeout: options.timeout ?? 10_000,
			fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
		};

		if (typeof this._input !== 'string' && !(this._input instanceof URL || this._input instanceof globalThis.Request)) {
			throw new TypeError('`input` must be a string, URL, or Request');
		}

		if (this._options.prefixUrl && typeof this._input === 'string') {
			if (this._input.startsWith('/')) {
				throw new Error('`input` must not begin with a slash when using `prefixUrl`');
			}

			if (!this._options.prefixUrl.endsWith('/')) {
				this._options.prefixUrl += '/';
			}

			this._input = this._options.prefixUrl + this._input;
		}

		if (supportsAbortController) {
			this.abortController = new globalThis.AbortController();
			const originalSignal = this._options.signal ?? (this._input as Request).signal;
			originalSignal?.addEventListener('abort', () => {
				this.abortController!.abort(originalSignal.reason);
			});

			this._options.signal = this.abortController.signal;
		}

		if (supportsRequestStreams) {
			// @ts-expect-error - Types are outdated.
			this._options.duplex = 'half';
		}

		if (this._options.json !== undefined) {
			this._options.body = this._options.stringifyJson?.(this._options.json) ?? JSON.stringify(this._options.json);
			this._options.headers.set('content-type', this._options.headers.get('content-type') ?? 'application/json');
		}

		this.request = new globalThis.Request(this._input, this._options);

		if (this._options.searchParams) {
			// eslint-disable-next-line unicorn/prevent-abbreviations
			const textSearchParams = typeof this._options.searchParams === 'string'
				? this._options.searchParams.replace(/^\?/, '')
				: new URLSearchParams(this._options.searchParams as unknown as SearchParamsInit).toString();
			// eslint-disable-next-line unicorn/prevent-abbreviations
			const searchParams = '?' + textSearchParams;
			const url = this.request.url.replace(/(?:\?.*?)?(?=#|$)/, searchParams);

			// To provide correct form boundary, Content-Type header should be deleted each time when new Request instantiated from another one
			if (
				((supportsFormData && this._options.body instanceof globalThis.FormData)
					|| this._options.body instanceof URLSearchParams) && !(this._options.headers && (this._options.headers as Record<string, string>)['content-type'])
			) {
				this.request.headers.delete('content-type');
			}

			// The spread of `this.request` is required as otherwise it misses the `duplex` option for some reason and throws.
			this.request = new globalThis.Request(new globalThis.Request(url, {...this.request}), this._options as RequestInit);
		}

		// Add onUploadProgress handling
		if (this._options.onUploadProgress && typeof this._options.onUploadProgress === 'function') {
			if (!supportsRequestStreams) {
				throw new Error('Request streams are not supported in your environment. The `duplex` option for `Request` is not available.');
			}

			const originalBody = this.request.body;
			if (originalBody) {
				const totalBytes = this._getTotalBytes(this._options.body);
				this.request
					= new globalThis.Request(this._input, {
						...this._options,
						body: this._streamRequest(
							originalBody, totalBytes, this._options.onUploadProgress),
					});
			}
		}
	}

	protected _calculateRetryDelay(error: unknown) {
		this._retryCount++;

		if (this._retryCount > this._options.retry.limit || error instanceof TimeoutError) {
			throw error;
		}

		if (error instanceof HTTPError) {
			if (!this._options.retry.statusCodes.includes(error.response.status)) {
				throw error;
			}

			const retryAfter = error.response.headers.get('Retry-After')
				?? error.response.headers.get('RateLimit-Reset')
				?? error.response.headers.get('X-RateLimit-Reset') // GitHub
				?? error.response.headers.get('X-Rate-Limit-Reset'); // Twitter
			if (retryAfter && this._options.retry.afterStatusCodes.includes(error.response.status)) {
				let after = Number(retryAfter) * 1000;
				if (Number.isNaN(after)) {
					after = Date.parse(retryAfter) - Date.now();
				} else if (after >= Date.parse('2024-01-01')) {
					// A large number is treated as a timestamp (fixed threshold protects against clock skew)
					after -= Date.now();
				}

				const max = this._options.retry.maxRetryAfter ?? after;
				return after < max ? after : max;
			}

			if (error.response.status === 413) {
				throw error;
			}
		}

		const retryDelay = this._options.retry.delay(this._retryCount);
		return Math.min(this._options.retry.backoffLimit, retryDelay);
	}

	protected _decorateResponse(response: Response): Response {
		if (this._options.parseJson) {
			response.json = async () => this._options.parseJson!(await response.text());
		}

		return response;
	}

	protected async _retry<T extends (...arguments_: any) => Promise<any>>(function_: T): Promise<ReturnType<T> | void> {
		try {
			return await function_();
		} catch (error) {
			const ms = Math.min(this._calculateRetryDelay(error), maxSafeTimeout);
			if (this._retryCount < 1) {
				throw error;
			}

			await delay(ms, {signal: this._options.signal});

			for (const hook of this._options.hooks.beforeRetry) {
				// eslint-disable-next-line no-await-in-loop
				const hookResult = await hook({
					request: this.request,
					options: (this._options as unknown) as NormalizedOptions,
					error: error as Error,
					retryCount: this._retryCount,
				});

				// If `stop` is returned from the hook, the retry process is stopped
				if (hookResult === stop) {
					return;
				}
			}

			return this._retry(function_);
		}
	}

	protected async _fetch(): Promise<Response> {
		for (const hook of this._options.hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			const result = await hook(this.request, (this._options as unknown) as NormalizedOptions);

			if (result instanceof Request) {
				this.request = result;
				break;
			}

			if (result instanceof Response) {
				return result;
			}
		}

		const nonRequestOptions = findUnknownOptions(this.request, this._options);

		// Cloning is done here to prepare in advance for retries
		const mainRequest = this.request;
		this.request = mainRequest.clone();

		if (this._options.timeout === false) {
			return this._options.fetch(mainRequest, nonRequestOptions);
		}

		return timeout(mainRequest, nonRequestOptions, this.abortController, this._options as TimeoutOptions);
	}

	/* istanbul ignore next */
	protected _streamResponse(response: Response, onDownloadProgress: Options['onDownloadProgress']) {
		const totalBytes = Number(response.headers.get('content-length')) || 0;
		let transferredBytes = 0;

		if (response.status === 204) {
			if (onDownloadProgress) {
				onDownloadProgress({percent: 1, totalBytes, transferredBytes}, new Uint8Array());
			}

			return new globalThis.Response(
				null,
				{
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				},
			);
		}

		return new globalThis.Response(
			new globalThis.ReadableStream({
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
	}

	// eslint-disable-next-line @typescript-eslint/ban-types
	protected _getTotalBytes(body?: globalThis.BodyInit | null): number {
		if (!body) {
			return 0;
		}

		if (body instanceof globalThis.FormData) {
			// This is an approximation, as FormData size calculation is not straightforward
			let size = 0;
			// eslint-disable-next-line unicorn/no-array-for-each -- FormData uses forEach method
			body.forEach((value: globalThis.FormDataEntryValue, key: string) => {
				if (typeof value === 'string') {
					size += new globalThis.TextEncoder().encode(value).length;
				} else if (typeof value === 'object' && value !== null && 'size' in value) {
					// This catches File objects as well, as File extends Blob
					size += (value as Blob).size;
				}

				// Add some bytes for field name and multipart boundaries
				size += new TextEncoder().encode(key).length + 40; // 40 is an approximation for multipart overhead
			});

			return size;
		}

		if (body instanceof globalThis.Blob) {
			return body.size;
		}

		if (body instanceof globalThis.ArrayBuffer) {
			return body.byteLength;
		}

		if (typeof body === 'string') {
			return new globalThis.TextEncoder().encode(body).length;
		}

		if (body instanceof URLSearchParams) {
			return new globalThis.TextEncoder().encode(body.toString()).length;
		}

		if ('byteLength' in body) {
			return (body).byteLength;
		}

		if (typeof body === 'object' && body !== null) {
			try {
				const jsonString = JSON.stringify(body);
				return new TextEncoder().encode(jsonString).length;
			} catch (error) {
				console.warn('Unable to stringify object:', error);
				return 0;
			}
		}

		return 0; // Default case, unable to determine size
	}

	protected _streamRequest(
		body: BodyInit,
		totalBytes: number,
		onUploadProgress: (progress: {percent: number; transferredBytes: number; totalBytes: number}) => void,
	): globalThis.ReadableStream<Uint8Array> {
		let transferredBytes = 0;

		return new globalThis.ReadableStream({
			async start(controller) {
				const reader = body instanceof globalThis.ReadableStream ? body.getReader() : new globalThis.Response(body).body!.getReader();

				async function read() {
					const {done, value} = await reader.read();
					if (done) {
						// Ensure 100% progress is reported when the upload is complete
						onUploadProgress({percent: 1, transferredBytes, totalBytes: Math.max(totalBytes, transferredBytes)});
						controller.close();
						return;
					}

					transferredBytes += value.byteLength as number;
					let percent = totalBytes === 0 ? 0 : transferredBytes / totalBytes;
					if (totalBytes < transferredBytes || percent === 1) {
						percent = 0.99;
					}

					onUploadProgress({percent: Number(percent.toFixed(2)), transferredBytes, totalBytes});

					controller.enqueue(value);
					await read();
				}

				await read();
			},
		});
	}
}
