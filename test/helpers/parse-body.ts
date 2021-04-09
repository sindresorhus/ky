import body from 'raw-body';
import type {Request} from 'express';

export const parseJsonBody = async <T = any>(request: Request): Promise<T> => {
	const buffer = await body(request);
	return JSON.parse(buffer.toString()) as T;
};

export const parseRawBody = async (request: Request): Promise<string> => {
	const buffer = await body(request);
	return buffer.toString();
};
