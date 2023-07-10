/* eslint-disable @typescript-eslint/no-use-before-define */

import { getConnection, logBeforeTimeout } from '@firestone-hs/aws-lambda-utils';
import { SES } from 'aws-sdk';
import { ServerlessMysql } from 'serverless-mysql';

// Take more in case we can't get the emails for the first 4
const WINNERS_TO_PICK = 8;

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	console.debug('event', event);
	const cleanup = logBeforeTimeout(context);

	// Last month, in YYYY-MM format
	const seasonInput = event?.season;
	const lastMonth = new Date();
	lastMonth.setMonth(lastMonth.getMonth() - 1);
	const season =
		seasonInput ?? lastMonth.getFullYear() + '-' + (lastMonth.getMonth() + 1).toString().padStart(2, '0');

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
