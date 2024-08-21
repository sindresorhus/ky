/*
Undici types need to be here because they are not exported to globals by @types/node.
See https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/69408

After the types are exported to globals, the Undici types can be removed from here.
*/

type UndiciHeadersInit =
	| string[][]
	| Record<string, string | readonly string[]>
	| Headers;

type UndiciBodyInit =
	| ArrayBuffer
	| AsyncIterable<Uint8Array>
	| Blob
	| FormData
	| Iterable<Uint8Array>
	| ArrayBufferView
	| URLSearchParams
	// eslint-disable-next-line @typescript-eslint/ban-types
	| null
	| string;

type UndiciRequestRedirect = 'error' | 'follow' | 'manual';

type UndiciRequestCredentials = 'omit' | 'include' | 'same-origin';

type UndiciReferrerPolicy =
	| ''
	| 'no-referrer'
	| 'no-referrer-when-downgrade'
	| 'origin'
	| 'origin-when-cross-origin'
	| 'same-origin'
	| 'strict-origin'
	| 'strict-origin-when-cross-origin'
	| 'unsafe-url';

type UndiciRequestMode = 'cors' | 'navigate' | 'no-cors' | 'same-origin';

type UndiciRequestInit = {
	method?: string;
	keepalive?: boolean;
	headers?: UndiciHeadersInit;
	body?: UndiciBodyInit;
	redirect?: UndiciRequestRedirect;
	integrity?: string;
	signal?: AbortSignal | undefined;
	credentials?: UndiciRequestCredentials;
	mode?: UndiciRequestMode;
	referrer?: string;
	referrerPolicy?: UndiciReferrerPolicy;
	window?: undefined;
	dispatcher?: unknown;
	duplex?: unknown;
};

type CombinedRequestInit = globalThis.RequestInit & UndiciRequestInit;

export type RequestInitRegistry = {[K in keyof CombinedRequestInit]-?: true};

export type KyRequest<T = unknown> = {
	json: <J = T>() => Promise<J>;
} & Request;
