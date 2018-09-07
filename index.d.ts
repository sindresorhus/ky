type Method =
  | 'get'
  | 'delete'
  | 'head'
  | 'post'
  | 'put'
  | 'patch'

type ResponseType =
  | 'arraybuffer'
  | 'blob'
  | 'json'
  | 'text'
  | 'formData'

interface IRequestConfig extends RequestInit{
  url?: string;
  retry: number;
  timeout: number;
}

interface HTTPError extends Error {
  name: string;
  response: Response;
}

interface TimeoutError extends Error {
  name: string;
}

interface IKy {
  (input?: Request | string, init?: IRequestConfig): Promise<Response>
  get (input?: Request | string, init?: IRequestConfig): Promise<Response>;
  post (input?: Request | string, init?: IRequestConfig): Promise<Response>;
  put (input?: Request | string, init?: IRequestConfig): Promise<Response>;
  patch (input?: Request | string, init?: IRequestConfig): Promise<Response>;
  head (input?: Request | string, init?: IRequestConfig): Promise<Response>;
  delete (input?: Request | string, init?: IRequestConfig): Promise<Response>;

  extend (defaultOptions: IRequestConfig): ky;

  HTTPError: HTTPError;
  TimeoutError: TimeoutError;
}

export default IKy;
