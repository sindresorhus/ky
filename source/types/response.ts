export type KyResponse<T = unknown> = {
	clone: () => KyResponse<T>;
	json: <J = T>() => Promise<J>;
} & Response;
