import fetch, {Headers, Response} from 'node-fetch';

global.fetch = fetch;
global.Headers = Headers;
global.Response = Response;
