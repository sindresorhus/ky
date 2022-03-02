import {HTTPError} from '../errors/HTTPError.js';
import {TimeoutError} from '../errors/TimeoutError.js';
import type {Hooks} from '../types/hooks.js';
import type {Input, InternalOptions, NormalizedOptions, Options, SearchParamsInit} from '../types/options.js';
import {ResponsePromise} from '../types/response.js';
import {deepMerge, mergeHeaders} from '../utils/merge.js';
import {normalizeRequestMethod, normalizeRetryOptions} from '../utils/normalize.js';
import {delay, timeout, TimeoutOptions} from '../utils/time.js';
import {ObjectEntries} from '../utils/types.js';
import {maxSafeTimeout, responseTypes, stop, supportsAbortController, supportsFormData, supportsStreams} from './constants.js';

export class Ky {
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	static create(input: Input, options: Options): ResponsePromise {
		const ky = new Ky(input, options);

		const fn = async (): Promise<Response> => {
			if (ky._options.timeout > maxSafeTimeout) {
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
				let error = new HTTPError(response, ky.request, (ky._options as unknown) as NormalizedOptions);

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

				if (!supportsStreams) {
					throw new Error('Streams are not supported in your environment. `ReadableStream` is missing.');
				}

				return ky._stream(response.clone(), ky._options.onDownloadProgress);
			}

			return response;
		};

		const isRetriableMethod = ky._options.retry.methods.includes(ky.request.method.toLowerCase());
		const result = (isRetriableMethod ? ky._retry(fn) : fn()) as ResponsePromise;

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
			// TODO: credentials can be removed when the spec change is implemented in all browsers. Context: https://www.chromestatus.com/feature/4539473312350208
			credentials: (this._input as Request).credentials || 'same-origin',
			...options,
			headers: mergeHeaders((this._input as Request).headers, options.headers),
			hooks: deepMerge<Required<Hooks>>(
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
			timeout: typeof options.timeout === 'undefined' ? 10_000 : options.timeout,
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
			if (this._options.signal) {
				this._options.signal.addEventListener('abort', () => {
					this.abortController!.abort();
				});
			}

			this._options.signal = this.abortController.signal;
		}

		this.request = new globalThis.Request(this._input as RequestInfo, this._options as RequestInit);

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

			this.request = new globalThis.Request(new globalThis.Request(url, this.request), this._options as RequestInit);
		}

		if (this._options.json !== undefined) {
			this._options.body = JSON.stringify(this._options.json);
			this.request.headers.set('content-type', this._options.headers.get('content-type') ?? 'application/json');
			this.request = new globalThis.Request(this.request, {body: this._options.body});
		}
	}

	protected _calculateRetryDelay(error: unknown) {
		this._retryCount++;

		if (this._retryCount < this._options.retry.limit && !(error instanceof TimeoutError)) {
			if (error instanceof HTTPError) {
				if (!this._options.retry.statusCodes.includes(error.response.status)) {
					return 0;
				}

				const retryAfter = error.response.headers.get('Retry-After');
				if (retryAfter && this._options.retry.afterStatusCodes.includes(error.response.status)) {
					let after = Number(retryAfter);
					if (Number.isNaN(after)) {
						after = Date.parse(retryAfter) - Date.now();
					} else {
						after *= 1000;
					}

					if (typeof this._options.retry.maxRetryAfter !== 'undefined' && after > this._options.retry.maxRetryAfter) {
						return 0;
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

	protected _decorateResponse(response: Response): Response {
		if (this._options.parseJson) {
			response.json = async () => this._options.parseJson!(await response.text());
		}

		return response;
	}

	protected async _retry<T extends (...args: any) => Promise<any>>(fn: T): Promise<ReturnType<T> | void> {
		try {
			return await fn();
			// eslint-disable-next-line @typescript-eslint/no-implicit-any-catch
		} catch (error) {
			const ms = Math.min(this._calculateRetryDelay(error), maxSafeTimeout);
			if (ms !== 0 && this._retryCount > 0) {
				await delay(ms);

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

				return this._retry(fn);
			}

			throw error;
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

		if (this._options.timeout === false) {
			return this._options.fetch(this.request.clone());
		}

		return timeout(this.request.clone(), this.abortController, this._options as TimeoutOptions);
	}

	/* istanbul ignore next */
	protected _stream(response: Response, onDownloadProgress: Options['onDownloadProgress']) {
		const totalBytes = Number(response.headers.get('content-length')) || 0;
		let transferredBytes = 0;

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
		);
	}
}
