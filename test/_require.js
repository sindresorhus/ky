import {URL} from 'url';
import fetch, {Headers} from 'node-fetch';

global.self = {
	fetch,
	Headers
};
global.URL = URL;
