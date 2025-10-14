import {performance} from 'node:perf_hooks';
import process from 'node:process';
import type {ExecutionContext} from 'ava';

type Argument = {
	expectedDuration: number;
	t: ExecutionContext;
	test: () => Promise<void>;
};

// We allow the tests to take more time on CI than locally, to reduce flakiness
// Node.js 24 has higher overhead on CI (~400-450ms), so we increase the tolerance
const nodeVersion = Number(process.versions.node.split('.')[0]);
const allowedOffset = process.env.CI ? (nodeVersion >= 24 ? 500 : 300) : 200;

export async function withPerformance({
	expectedDuration,
	t,
	test,
}: Argument) {
	const startTime = performance.now();
	await test();
	const endTime = performance.now();

	const duration = endTime - startTime;
	t.true(
		Math.abs(duration - expectedDuration) < allowedOffset,
		`Duration of ${duration}ms is not close to expected duration ${expectedDuration}ms`,
	);
}
