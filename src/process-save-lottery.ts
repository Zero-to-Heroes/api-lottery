/* eslint-disable @typescript-eslint/no-use-before-define */

import { getConnection, validateFirestoneToken } from '@firestone-hs/aws-lambda-utils';
import { LotteryInput } from './public-api';

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	// const cleanup = logBeforeTimeout(context);

	const events: readonly LotteryInput[] = (event.Records as any[])
		.map((event) => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), []);
	console.debug('processing', events.length, 'events');

	const validationEvents = await Promise.all(events.map((ev) => validateEvent(ev)));
	const validEvents = validationEvents.filter((ev) => ev);
	console.debug('validated', validEvents.length, 'events');

	const mysql = await getConnection();
	const values = validEvents.map((ev) => [ev.username, ev.message.season, ev.message.points]);
	if (values.length > 0) {
		const placeholders = values.map(() => '(?, ?, ?)').join(', ');
		const query = `INSERT INTO lottery (userName, season, points) VALUES ${placeholders} ON DUPLICATE KEY UPDATE points = VALUES(points)`;
		const flattenedValues = values.flat();
		await mysql.query(query, flattenedValues);
	}
	await mysql.end();

	const response = {
		statusCode: 200,
		isBase64Encoded: false,
		body: null,
	};
	return response;
};

const validateEvent = async (message: LotteryInput): Promise<{ message: LotteryInput; username: string } | null> => {
	const token = message.jwt;
	if (!token) {
		return null;
	}
	let userName = null;
	try {
		const validationResult = await validateFirestoneToken(token);
		if (!validationResult?.username) {
			return null;
		}
		userName = validationResult.username;
	} catch (e) {
		console.log('expired token', token);
		return null;
	}

	return { message, username: userName };
};
