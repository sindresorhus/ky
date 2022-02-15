import process from 'node:process';
import type {ExecutionContext, UntitledMacro} from 'ava';
import {chromium, Page} from 'playwright-chromium';

type Run = (t: ExecutionContext, page: Page) => Promise<void>;

const PWDEBUG = Boolean(process.env['PWDEBUG']);

export const withPage: UntitledMacro<any[]> = async (t: ExecutionContext, run: Run): Promise<void> => {
	const browser = await chromium.launch({
		devtools: PWDEBUG,
	});
	const page = await browser.newPage();
	try {
		await run(t, page);
	} finally {
		await browser.close();
	}
};
