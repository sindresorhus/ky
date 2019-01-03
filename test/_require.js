import {URL, URLSearchParams} from 'url';
import fetch, {Response} from 'node-fetch';

global.fetch = fetch;
global.Response = Response;
global.URL = URL;
global.URLSearchParams = URLSearchParams;
