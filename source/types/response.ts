export type KyResponse<T = unknown> = {
	json: <J = T >() => Promise<J>;
} & Response;
