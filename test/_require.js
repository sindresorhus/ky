import fetch, {Headers, Request, Response} from 'node-fetch';
import AbortController from 'abort-controller';

global.fetch = fetch;
global.Headers = Headers;
global.Request = Request;
global.Response = Response;
global.AbortController = AbortController;
