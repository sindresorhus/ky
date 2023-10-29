import {type RequestInit as UndiciRequestInit} from 'undici-types';

type CombinedRequestInit = globalThis.RequestInit & UndiciRequestInit;

export type RequestInitRegistry = {[K in keyof CombinedRequestInit]-?: true};
