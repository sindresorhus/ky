import fetch, {Headers, Request, Response} from 'node-fetch';
import AbortController from 'abort-controller';
import FormData from 'form-data';

globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;
globalThis.AbortController = AbortController;
globalThis.FormData = FormData;
