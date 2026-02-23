import process from 'node:process';
import test, {type ExecutionContext} from 'ava';
import {
	chromium,
	firefox,
	webkit,
	type BrowserType,
	type Page,
} from 'playwright';

type Run = (t: ExecutionContext, page: Page) => Promise<void>;

const PWDEBUG = Boolean(process.env.PWDEBUG);
const DEFAULT_BROWSERS = [chromium, firefox, webkit];
const BROWSER_TEST_TIMEOUT_MS = 20_000;
const BROWSER_CLEANUP_TIMEOUT_MS = process.env.CI ? 20_000 : 5000;
const BROWSER_TOTAL_TIMEOUT_MS = BROWSER_TEST_TIMEOUT_MS + BROWSER_CLEANUP_TIMEOUT_MS;

export const promiseWithTimeout = async <Value>(
	promise: Promise<Value>,
	timeoutInMilliseconds: number,
	errorMessage: string,
): Promise<Value> => new Promise((resolve, reject) => {
	const timeoutIdentifier = setTimeout(() => {
		reject(new Error(errorMessage));
	}, timeoutInMilliseconds);

	promise
		.then(value => {
			clearTimeout(timeoutIdentifier);
			resolve(value);
		})
		.catch((error: unknown) => {
			clearTimeout(timeoutIdentifier);
			reject(error instanceof Error ? error : new Error(String(error)));
		});
});

export const browserTest = (title: string, browserTypes: BrowserType[], run: Run) => {
	for (const browserType of browserTypes) {
		test.serial(`${browserType.name()} - ${title}`, async t => {
			t.timeout(BROWSER_TOTAL_TIMEOUT_MS);

			const browser = await promiseWithTimeout(
				browserType.launch({devtools: PWDEBUG}),
				BROWSER_TEST_TIMEOUT_MS,
				`${browserType.name()} launch timed out`,
			);
			const pagePromise = promiseWithTimeout(
				browser.newPage(),
				BROWSER_TEST_TIMEOUT_MS,
				`${browserType.name()} page creation timed out`,
			);

			t.teardown(async () => {
				try {
					const page = await pagePromise.catch(() => undefined);
					if (page) {
						await promiseWithTimeout(
							page.close(),
							BROWSER_CLEANUP_TIMEOUT_MS,
							`${browserType.name()} page close timed out`,
						);
					}
				} finally {
					await promiseWithTimeout(
						browser.close(),
						BROWSER_CLEANUP_TIMEOUT_MS,
						`${browserType.name()} close timed out`,
					);
				}
			});

			const page = await pagePromise;
			await run(t, page);
		});
	}
};

export const defaultBrowsersTest = (title: string, run: Run) => {
	browserTest(title, DEFAULT_BROWSERS, run);
};
