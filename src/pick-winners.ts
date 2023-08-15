/* eslint-disable @typescript-eslint/no-use-before-define */

import { S3, getConnection, logBeforeTimeout, logger } from '@firestone-hs/aws-lambda-utils';
import { SES } from 'aws-sdk';
import { ServerlessMysql } from 'serverless-mysql';
import { BUCKET, LOTTERY_SEASONS_FILE, LotterySeason } from './start-new-season';

const s3 = new S3();

// Take more in case we can't get the emails for the first 4
const WINNERS_TO_PICK = 8;

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	// This has first run on a Saturday, on 2023-07-17
	// It should now run every two weeks, starting from that date
	const originDate = new Date('2023-07-17');
	const now = new Date();
	const diff = now.getTime() - originDate.getTime();
	const diffInDays = Math.floor(diff / (1000 * 3600 * 24));
	logger.log('Is a new season day?', diffInDays);
	if (diffInDays % 14 !== 0) {
		logger.log('Not a new season day', diffInDays);
		return { statusCode: 200, body: '' };
	}

	console.debug('event', event);
	const cleanup = logBeforeTimeout(context);

	// Get the config file from S3
	const seasonsStr = await s3.readContentAsString(BUCKET, LOTTERY_SEASONS_FILE, 1);
	const allSeasons: readonly LotterySeason[] = JSON.parse(seasonsStr);
	logger.debug('loaded seasons', allSeasons);

	const seasonClosestToNow = allSeasons
		.map((season) => ({ season: season, diff: new Date(season.startDate).getTime() - new Date().getTime() }))
		// Keep only seasons that are in the past
		.filter((season) => season.diff < 0)
		// Ignore the current one
		.sort((a, b) => b.diff - a.diff)[1];
	const seasonConfig = seasonClosestToNow?.season ?? allSeasons[0];
	const season = '' + seasonConfig?.id;

	const mysql = await getConnection();
	const allEntries: readonly RaffleEntry[] = await getAllEntries(mysql, season);
	await mysql.end();
	const totalPoints = allEntries.map((entry) => entry.points).reduce((a, b) => a + b, 0);
	const winners = pickWinners(allEntries, totalPoints);

	const text = `
		Season: ${season}
		Total points: ${totalPoints}
		Winners: ${winners.map((entry) => entry.userName).join(', ')}

		${JSON.stringify(winners, null, 4)}
	`;

	const params: SES.Types.SendEmailRequest = {
		Destination: {
			ToAddresses: ['support@firestoneapp.com'],
		},
		Message: {
			Subject: {
				Charset: 'UTF-8',
				Data: 'Lottery winners',
			},
			Body: {
				Text: {
					Charset: 'UTF-8',
					Data: text,
				},
			},
		},
		Source: 'seb@firestoneapp.com',
		ReplyToAddresses: ['seb@firestoneapp.com'],
	} as SES.Types.SendEmailRequest;
	const result = await new SES({ apiVersion: '2010-12-01' }).sendEmail(params).promise();

	cleanup();
	return { statusCode: 200, body: '' };
};

const getAllEntries = async (mysql: ServerlessMysql, season: string): Promise<readonly RaffleEntry[]> => {
	const result: readonly any[] = await mysql.query('SELECT * FROM lottery WHERE season = ?', [season]);
	const mapped = result.map((entry) => ({
		userName: entry.userName,
		season: entry.season,
		points: entry.points,
	}));
	const shuffled = shuffleArray(mapped);
	return shuffled;
};

const pickWinners = (allEntries: readonly RaffleEntry[], totalPoints: number): readonly RaffleEntry[] => {
	const winners: RaffleEntry[] = [];
	const winnersToPick = WINNERS_TO_PICK;
	while (winners.length < winnersToPick) {
		const random = Math.floor(Math.random() * totalPoints);
		let currentTotal = 0;
		for (const entry of allEntries) {
			currentTotal += entry.points;
			if (currentTotal >= random && !winners.includes(entry)) {
				winners.push(entry);
				break;
			}
		}
		// Prevent infinite loop in case we have fewer winners in DB than expected
		if (winners.length === allEntries.length) {
			break;
		}
	}
	return winners;
};

const shuffleArray = <T>(array: T[]): T[] => {
	const shuffledArray = [...array]; // Create a copy of the original array

	for (let i = shuffledArray.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1)); // Generate a random index

		// Swap elements at indices i and j
		[shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
	}

	return shuffledArray;
};

interface RaffleEntry {
	readonly userName: string;
	readonly season: string;
	readonly points: number;
}
