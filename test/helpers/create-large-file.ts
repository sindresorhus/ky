// Helper function to create a large Blob
export function createLargeBlob(sizeInMB: number): Blob {
	const chunkSize = 1024 * 1024; // 1MB
	// eslint-disable-next-line unicorn/no-new-array
	const chunks = new Array(sizeInMB).fill('x'.repeat(chunkSize));
	return new Blob(chunks, {type: 'application/octet-stream'});
}
