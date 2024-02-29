type UndiciRequestInit = {
	method?: string;
	keepalive?: boolean;
	headers?: HeadersInit;
	body?: BodyInit;
	redirect?: RequestRedirect;
	integrity?: string;
	signal?: AbortSignal | undefined;
	credentials?: RequestCredentials;
	mode?: RequestMode;
	referrer?: string;
	referrerPolicy?: ReferrerPolicy;
	window?: undefined;
	dispatcher?: unknown;
	duplex?: unknown;
};

type CombinedRequestInit = globalThis.RequestInit & UndiciRequestInit;

export type RequestInitRegistry = {[K in keyof CombinedRequestInit]-?: true};
