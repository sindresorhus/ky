import {performance, PerformanceObserver} from 'node:perf_hooks';
import process from 'node:process';
import type {ExecutionContext} from 'ava';

type Arg = {
	name: string;
	expectedDuration: number;
	t: ExecutionContext;
	test: () => Promise<void>;
};

// We allow the tests to take more time on CI than locally, to reduce flakiness
const allowedOffset = process.env.CI ? 1000 : 300;

export async function withPerformanceObserver({
	name,
	expectedDuration,
	t,
	test,
}: Arg) {
	// Register observer that asserts on duration when a measurement is performed
	const obs = new PerformanceObserver(items => {
		const measurements = items.getEntries();

		const duration = measurements[0].duration ?? Number.NaN;

		t.true(
			Math.abs(duration - expectedDuration) < allowedOffset,
			`Duration of ${duration}ms is not close to expected duration ${expectedDuration}ms`,
		);

		obs.disconnect();
	});
	obs.observe({entryTypes: ['measure']});

	// Start measuring
	performance.mark(`start-${name}`);
	await test();
	performance.mark(`end-${name}`);

	performance.measure(name, `start-${name}`, `end-${name}`);
}
