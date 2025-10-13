export type KyRequest<T = unknown> = {
	json: <J = T>() => Promise<J>;
} & Request;
