/**
Returns a `Response` object with `Body` methods added for convenience. So you can, for example, call `ky.get(input).json()` directly without having to await the `Response` first. When called like that, an appropriate `Accept` header will be set depending on the body method used. Unlike the `Body` methods of `window.Fetch`; these will throw an `HTTPError` if the response status is not in the range of `200...299`. Also, `.json()` will return `undefined` if body is empty or the response status is `204` instead of throwing a parse error due to an empty body.
*/
import {type KyResponse} from './response.js';
import type {StandardSchemaV1, StandardSchemaV1InferOutput} from './standard-schema.js';

export type ResponsePromise<T = unknown> = {
	arrayBuffer: () => Promise<ArrayBuffer>;

	blob: () => Promise<Blob>;

	formData: () => Promise<FormData>;

	/**
	Get the response body as raw bytes.

	Note: This shortcut is only available when the runtime supports `Response.prototype.bytes()`.
	*/
	bytes: () => Promise<Uint8Array>;

	// TODO: Use `json<T extends JSONValue>(): Promise<T>;` when it's fixed in TS.
	// See https://github.com/microsoft/TypeScript/issues/15300 and https://github.com/sindresorhus/ky/pull/80
	json: {
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
		<JsonType = T>(): Promise<JsonType | undefined>;

		/**
		Get the response body as JSON and validate it with a Standard Schema.
		Use a Standard Schema compatible validator (for example, Zod 3.24+).

		Throws a `SchemaValidationError` when validation fails.

		@example
		```
		import ky from 'ky';
		import {z} from 'zod';

		const userSchema = z.object({name: z.string()});

		const user = await ky('/api/user').json(userSchema);
		```
		*/
		<Schema extends StandardSchemaV1>(schema: Schema): Promise<StandardSchemaV1InferOutput<Schema>>;
	};

	text: () => Promise<string>;
} & Promise<KyResponse<T>>;
