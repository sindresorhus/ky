/* eslint-disable ava/no-ignored-test-files */
import process from 'node:process';
import test from 'ava';
import {chromium, firefox, webkit, type BrowserType, type Page} from 'playwright';
import type {ExecutionContext} from 'ava';

type Run = (t: ExecutionContext, page: Page) => Promise<void>;

const PWDEBUG = Boolean(process.env['PWDEBUG']);
const DEFAULT_BROWSERS = [chromium, firefox, webkit];

export const browserTest = (title: string, browserTypes: BrowserType[], run: Run) => {
	for (const browserType of browserTypes) {
		test.serial(`${browserType.name()} - ${title}`, async t => {
			const browser = await browserType.launch({devtools: PWDEBUG});
			const page = await browser.newPage();
			try {
				await run(t, page);
			} finally {
				await browser.close();
			}
		});
	}
};

export const defaultBrowsersTest = (title: string, run: Run) => {
	browserTest(title, DEFAULT_BROWSERS, run);
};
