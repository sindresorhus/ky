export interface KyResponse extends Response {
	json: <T = unknown>() => Promise<T>;
}
