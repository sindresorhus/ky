export type KyRequest<T = unknown> = {
	clone: () => KyRequest<T>;
	json: <J = T>() => Promise<J>;
} & Request;
