import fetch, {Headers} from 'node-fetch';

global.window = {
	fetch,
	Headers
};
