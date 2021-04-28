import fetch, {Headers, Request, Response} from 'node-fetch';
import AbortController from 'abort-controller';
import FormData from 'form-data';

globalThis.AbortController = AbortController;
// @ts-expect-error
globalThis.fetch = fetch;
// @ts-expect-error
globalThis.Headers = Headers;
// @ts-expect-error
globalThis.Request = Request;
// @ts-expect-error
globalThis.Response = Response;
// @ts-expect-error
globalThis.FormData = FormData;
