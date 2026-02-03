export const grpcSupport = (options: any) => { 
    if (options.protobuf) { 
        options.headers = { 
            ...options.headers, 
            'Content-Type': 'application/x-protobuf',
            'Accept': 'application/x-protobuf'
        }; 
        options.body = options.protobuf.serialize();
    } 
    return options; 
};