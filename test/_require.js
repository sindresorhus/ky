import fetch, {Headers, Response, Request} from 'node-fetch';
import AbortController from 'abort-controller';

global.fetch = fetch;
global.Headers = Headers;
global.Response = Response;
global.AbortController = AbortController;
global.Request = Request;
