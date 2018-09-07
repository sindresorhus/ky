type Method =
  | 'get'
  | 'delete'
  | 'head'
  | 'post'
  | 'put'
  | 'patch';

type ResponseType =
  | 'arraybuffer'
  | 'blob'
  | 'json'
  | 'text'
  | 'formData';

interface Options extends RequestInit{
  retry?: number;
  timeout?: number;
}

/**
 * The error has a response property with the Response object.
 */
export interface HTTPError extends Error {
  response: Response;
}

/**
 * The error thrown when the request times out.
 */
export interface TimeoutError extends Error {
}

interface Ky {
	(input: Request | string, options?: Options): Promise<Response>;
	
  get (input: Request | string, options?: Options): Promise<Response>;
  post (input: Request | string, options?: Options): Promise<Response>;
  put (input: Request | string, options?: Options): Promise<Response>;
  patch (input: Request | string, options?: Options): Promise<Response>;
  head (input: Request | string, options?: Options): Promise<Response>;
  delete (input: Request | string, options?: Options): Promise<Response>;

  extend (defaultOptions: Options): Ky;

  HTTPError: HTTPError;
  TimeoutError: TimeoutError;
}

export default Ky;
