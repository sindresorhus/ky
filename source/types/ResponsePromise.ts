/**
Returns a `Response` object with `Body` methods added for convenience. So you can, for example, call `ky.get(input).json()` directly without having to await the `Response` first. When called like that, an appropriate `Accept` header will be set depending on the body method used. Unlike the `Body` methods of `window.Fetch`; these will throw an `HTTPError` if the response status is not in the range of `200...299`. Also, `.json()` will return an empty string if body is empty or the response status is `204` instead of throwing a parse error due to an empty body.
*/
import {type KyResponse} from './response.js';

export type ResponsePromise<T = unknown> = {
	arrayBuffer: () => Promise<ArrayBuffer>;

	blob: () => Promise<Blob>;

	formData: () => Promise<FormData>;

	// TODO: Use `json<T extends JSONValue>(): Promise<T>;` when it's fixed in TS.
	// See https://github.com/microsoft/TypeScript/issues/15300 and https://github.com/sindresorhus/ky/pull/80
	/**
	Get the response body as JSON.

	@example
	```
	import ky from 'ky';

	const json = await ky(…).json();
	```

	@example
	```
	import ky from 'ky';

	interface Result {
		value: number;
	}

	const result1 = await ky(…).json<Result>();
	// or
	const result2 = await ky<Result>(…).json();
	```
	*/
	json: <J = T>() => Promise<J>;

	text: () => Promise<string>;
} & Promise<KyResponse<T>>;
