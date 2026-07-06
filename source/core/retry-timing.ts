// Older epoch-second values are indistinguishable from ordinary delay seconds, so timestamp compatibility only applies to current-era reset headers.
const timestampThreshold = Date.parse('2024-01-01');
const delayPattern = /^\d+$/;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// HTTP-date parsing is limited to IMF-fixdate and the two obsolete HTTP-date formats. Other date-like strings intentionally fall back to the normal retry delay.
const imfDatePattern = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const rfc850DatePattern = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const asctimeDatePattern = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}| \d) (\d{2}:\d{2}:\d{2}) (\d{4})$/;

type RetryTimingHeader = {
	value: string;
	allowTimestamp: boolean;
};

type RetryTimingDateParts = {
	year: number;
	month: string;
	day: string;
	hours: string;
	minutes: string;
	seconds: string;
};

export const getRetryTimingHeader = (headers: Headers): RetryTimingHeader | undefined => {
	const retryAfter = headers.get('Retry-After');
	if (retryAfter !== null) {
		return {value: retryAfter, allowTimestamp: false};
	}

	// Retry-After is authoritative when present. Only missing Retry-After falls through to rate-limit headers.
	const rateLimitReset = headers.get('RateLimit-Reset');
	if (rateLimitReset !== null) {
		return {value: rateLimitReset, allowTimestamp: true};
	}

	const rateLimitRetryAfter = headers.get('X-RateLimit-Retry-After'); // Symfony-based services
	if (rateLimitRetryAfter !== null) {
		return {value: rateLimitRetryAfter, allowTimestamp: false};
	}

	const rateLimitResetAlias = headers.get('X-RateLimit-Reset') // GitHub
		?? headers.get('X-Rate-Limit-Reset'); // Twitter
	if (rateLimitResetAlias !== null) {
		return {value: rateLimitResetAlias, allowTimestamp: true};
	}

	return undefined;
};

const createTimestamp = ({year, month, day, hours, minutes, seconds}: RetryTimingDateParts): number | undefined => {
	const monthIndex = months.indexOf(month);
	const dayNumber = Number(day);
	const hoursNumber = Number(hours);
	const minutesNumber = Number(minutes);
	const secondsNumber = Number(seconds);
	if (
		monthIndex === -1
		|| hoursNumber > 23
		|| minutesNumber > 59
		|| secondsNumber > 60
	) {
		return undefined;
	}

	const normalizedSeconds = Math.min(secondsNumber, 59);
	const date = new Date(Date.UTC(year, monthIndex, dayNumber, hoursNumber, minutesNumber, normalizedSeconds));
	date.setUTCFullYear(year);
	const timestamp = date.getTime();

	// Date.UTC normalizes overflow, so round-trip the parts to reject invalid dates. A leap second is represented by parsing 60 as 59 and adding one second.
	if (
		date.getUTCFullYear() !== year
		|| date.getUTCMonth() !== monthIndex
		|| date.getUTCDate() !== dayNumber
		|| date.getUTCHours() !== hoursNumber
		|| date.getUTCMinutes() !== minutesNumber
		|| date.getUTCSeconds() !== normalizedSeconds
	) {
		return undefined;
	}

	return secondsNumber === 60 ? timestamp + 1000 : timestamp;
};

const getCapture = (match: RegExpExecArray, index: number): string => match[index]!;

const parseDate = (value: string): number | undefined => {
	const imfDate = imfDatePattern.exec(value);
	if (imfDate) {
		return createTimestamp({
			year: Number(getCapture(imfDate, 3)),
			month: getCapture(imfDate, 2),
			day: getCapture(imfDate, 1),
			hours: getCapture(imfDate, 4),
			minutes: getCapture(imfDate, 5),
			seconds: getCapture(imfDate, 6),
		});
	}

	const rfc850Date = rfc850DatePattern.exec(value);
	if (rfc850Date) {
		const now = new Date();
		const twoDigitYear = Number(getCapture(rfc850Date, 3));
		const currentCenturyYear = (Math.floor(now.getUTCFullYear() / 100) * 100) + twoDigitYear;
		const fiftyYearsFromNow = Date.UTC(now.getUTCFullYear() + 50, now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
		let timestamp: number | undefined;

		// RFC 9110 maps two-digit years to the latest matching century that is not more than 50 years in the future.
		for (const year of [
			currentCenturyYear - 100,
			currentCenturyYear,
			currentCenturyYear + 100,
		]) {
			const candidateTimestamp = createTimestamp({
				year,
				month: getCapture(rfc850Date, 2),
				day: getCapture(rfc850Date, 1),
				hours: getCapture(rfc850Date, 4),
				minutes: getCapture(rfc850Date, 5),
				seconds: getCapture(rfc850Date, 6),
			});
			if (
				candidateTimestamp !== undefined
				&& candidateTimestamp <= fiftyYearsFromNow
			) {
				timestamp = candidateTimestamp;
			}
		}

		return timestamp;
	}

	const asctimeDate = asctimeDatePattern.exec(value);
	if (asctimeDate) {
		const time = getCapture(asctimeDate, 4);
		const [hours, minutes, seconds] = time.split(':') as [string, string, string];
		return createTimestamp({
			year: Number(getCapture(asctimeDate, 5)),
			month: getCapture(asctimeDate, 2),
			day: getCapture(asctimeDate, 3).trim(),
			hours,
			minutes,
			seconds,
		});
	}

	return undefined;
};

export const calculateRetryTimingDelay = ({value, allowTimestamp}: RetryTimingHeader): number | undefined => {
	if (delayPattern.test(value)) {
		let delay = Number(value) * 1000;

		// Standard Retry-After numbers are delay seconds. Timestamp compatibility only applies to reset headers.
		if (
			allowTimestamp
			&& delay >= timestampThreshold
		) {
			delay -= Date.now();
		}

		return Math.max(0, delay);
	}

	const timestamp = parseDate(value);
	if (timestamp === undefined) {
		return undefined;
	}

	const delay = timestamp - Date.now();
	return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
};
