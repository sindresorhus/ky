/* eslint-disable @typescript-eslint/prefer-ts-expect-error */
import fetch, {Headers, Request, Response} from 'node-fetch';
import AbortController from 'abort-controller';
import FormData from 'form-data';

// We use `@ts-ignore` as there are some inconsistency error when using `@ts-expect-error`.

globalThis.AbortController = AbortController;
// @ts-ignore
globalThis.fetch = fetch;
// @ts-ignore
globalThis.Headers = Headers;
// @ts-ignore
globalThis.Request = Request;
// @ts-ignore
globalThis.Response = Response;
// @ts-ignore
globalThis.FormData = FormData;
