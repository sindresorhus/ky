import { URL } from 'url';
import fetch, {Headers} from 'node-fetch';

global.window = {
	fetch,
	Headers
};
global.document = {
	baseURI : 'https://example.com/'
};
global.URL = URL;