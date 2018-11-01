import {URL} from 'url';
import fetch, {Headers, Response} from 'node-fetch';

global.self = {
	fetch,
	Headers,
	Response
};
global.URL = URL;
