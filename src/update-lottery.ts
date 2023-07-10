/* eslint-disable @typescript-eslint/no-use-before-define */

import { getConnection, logBeforeTimeout, validateFirestoneToken } from '@firestone-hs/aws-lambda-utils';
import { logger } from '@firestone-hs/aws-lambda-utils/dist/services/logger';
import { ServerlessMysql } from 'serverless-mysql';
import { LotteryInput } from './public-api';

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	const cleanup = logBeforeTimeout(context);
	logger.debug('received message', event);
	const message: LotteryInput = JSON.parse(event.body);
	logger.debug('will process', message);

	const token = message.jwt;
	logger.debug('token', token);
	const validationResult = await validateFirestoneToken(token);
	logger.debug('validation result', validationResult);
	if (!validationResult?.username) {
		cleanup();
		return {
			statusCode: 403,
			body: 'could not decrypt token ' + token,
		};
	}

	const mysql = await getConnection();
	logger.log(
		'updating lottery points for ' +
			validationResult?.username +
			' in season ' +
			message.season +
			': ' +
			message.points,
	);
	await updateLottery(mysql, validationResult?.username, message.season, message.points);
	await mysql.end();
	cleanup();
	return { statusCode: 200, body: '' };
};

const updateLottery = async (
	mysql: ServerlessMysql,
	userName: string,
	season: string,
	points: number,
): Promise<void> => {
	await mysql.query(
		'INSERT INTO lottery (userName, season, points) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE points = ?',
		[userName, season, points, points],
	);
};
