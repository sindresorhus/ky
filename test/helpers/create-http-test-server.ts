import http from 'node:http';
import type net from 'node:net';
import {promisify} from 'node:util';
import express from 'express';

export type HttpServerOptions = {
	bodyParser?: false;
};

export type ExtendedHttpTestServer = {
	http: http.Server;
	url: string;
	port: number;
	hostname: string;
	close: () => Promise<any>;
} & express.Express;

export const createHttpTestServer = async (options: HttpServerOptions = {}): Promise<ExtendedHttpTestServer> => {
	const server = express() as ExtendedHttpTestServer;
	server.http = http.createServer(server);

	server.set('etag', false);
	server.http.keepAliveTimeout = 0;
	server.http.unref();

	if (options.bodyParser !== false) {
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
		return promisify(server.http.close.bind(server.http))();
	};

	return server;
};
