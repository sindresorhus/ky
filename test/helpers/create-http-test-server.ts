import http from 'node:http';
import type net from 'node:net';
import {promisify} from 'node:util';
import type {ExecutionContext} from 'ava';
import express from 'express';

export type HttpServerOptions = {
	bodyParser?: false;
};

export type ExtendedHttpTestServer = {
	http: http.Server;
	url: string;
	port: number;
	hostname: string;
	close: () => Promise<void>;
} & express.Express;

export async function createHttpTestServer(t: ExecutionContext, options?: HttpServerOptions): Promise<ExtendedHttpTestServer>;
export async function createHttpTestServer(options?: HttpServerOptions): Promise<ExtendedHttpTestServer>;
export async function createHttpTestServer(
	tOrOptions?: ExecutionContext | HttpServerOptions,
	options?: HttpServerOptions,
): Promise<ExtendedHttpTestServer> {
	const isExecutionContext = typeof (tOrOptions as ExecutionContext)?.teardown === 'function';
	const t = isExecutionContext ? tOrOptions as ExecutionContext : undefined;
	const resolvedOptions = (isExecutionContext ? options : tOrOptions as HttpServerOptions) ?? {};

	const server = express() as ExtendedHttpTestServer;
	server.http = http.createServer(server);

	server.set('etag', false);
	server.http.keepAliveTimeout = 0;
	server.http.unref();

	if (resolvedOptions.bodyParser !== false) {
		server.use(express.json({limit: '1mb', type: 'application/json'}));
		server.use(express.text({limit: '1mb', type: 'text/plain'}));
		server.use(express.urlencoded({limit: '1mb', type: 'application/x-www-form-urlencoded', extended: true}));
		server.use(express.raw({limit: '1mb', type: 'application/octet-stream'}));
	}

	await promisify(server.http.listen.bind(server.http))();

	server.port = (server.http.address() as net.AddressInfo).port;
	server.url = `http://localhost:${server.port}`;
	server.hostname = 'localhost';

	server.close = async () => {
		server.http.closeAllConnections();
		await promisify(server.http.close.bind(server.http))();
	};

	if (t) {
		t.teardown(server.close);
	}

	return server;
}
