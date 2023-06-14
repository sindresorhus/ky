export type KyResponse = {
	json: <T = unknown>() => Promise<T>;
} & Response;
