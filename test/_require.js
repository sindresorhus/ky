import {URL, URLSearchParams} from 'url';
import fetch, {Headers, Response} from 'node-fetch';
import AbortController from 'abort-controller';

global.fetch = fetch;
global.Headers = Headers;
global.Response = Response;
global.AbortController = AbortController;

if (process.version.match('v8\\.')) {
	global.URL = URL;
	global.URLSearchParams = URLSearchParams;
}
