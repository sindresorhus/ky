import {text} from 'node:stream/consumers';
import type {Request} from 'express';

export const parseJsonBody = async <T = any>(request: Request): Promise<T> => {
	const body = await text(request);
	return JSON.parse(body) as T;
};

export const parseRawBody = async (request: Request): Promise<string> => text(request);
