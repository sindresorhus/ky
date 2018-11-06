import {URL, URLSearchParams} from 'url';
import fetch, {Headers, Response} from 'node-fetch';

global.fetch = fetch;
global.Headers = Headers;
global.Response = Response;
global.URL = URL;
global.URLSearchParams = URLSearchParams;
global.document = {baseURI: 'http://example.com'};
