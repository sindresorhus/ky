import {chromium} from 'playwright-chromium';

export default async function withPage(t, run) {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	try {
		await run(t, page);
	} finally {
		await browser.close();
	}
}
