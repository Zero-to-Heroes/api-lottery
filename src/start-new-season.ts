/* eslint-disable @typescript-eslint/no-use-before-define */

import { S3, logBeforeTimeout } from '@firestone-hs/aws-lambda-utils';
import { AllCardsService } from '@firestone-hs/reference-data';
import { SES } from 'aws-sdk';

// Take more in case we can't get the emails for the first 4
const LOTTERY_SEASONS_FILE = 'api/lottery/lottery-seasons.json';
const LOTTERY_CONFIG_FILE = 'api/lottery/lottery-config.json';
const BUCKET = 'static.zerotoheroes.com';

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	console.debug('event', event);
	const cleanup = logBeforeTimeout(context);

	const allCards = new AllCardsService();
	await allCards.initializeCardsDb();

	// Get the config file from S3
	const s3 = new S3();
	const configStr = await s3.readContentAsString(BUCKET, LOTTERY_CONFIG_FILE, 1);
	const config: LotteryConfig = JSON.parse(configStr);
	console.debug('loaded config', config);

	// Get the current season file from S3
	let seasons: LotterySeason[] = [];
	try {
		const seasonsStr = await s3.readContentAsString(BUCKET, LOTTERY_SEASONS_FILE, 1);
		seasons = JSON.parse(seasonsStr) ?? [];
	} catch (e) {
		console.error('Could not parse seasons', e);
		seasons = [];
	}

	const lastSeasonId = seasons[seasons.length - 1]?.id;
	const newSeasonId = isNaN(lastSeasonId) ? 2 : lastSeasonId + 1;
	// Each season starts with a letter corresponding to its id, mod 26
	const newSeasonNameStart = String.fromCharCode(65 + (newSeasonId % 26));
	const newSeasonNameCandidates = allCards
		.getCards()
		.filter((card) => card.collectible)
		.filter((card) => card.name[0].toLowerCase() === newSeasonNameStart.toLowerCase())
		.map((card) => card.name);
	const newSeasonName = newSeasonNameCandidates[Math.floor(Math.random() * newSeasonNameCandidates.length)];
	// Date of the day after tomorrow, in the YYYY-MM-DD format
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 2);
	const tomorrowStr = tomorrow.toISOString().slice(0, 10);
	const newSeason: LotterySeason = {
		id: newSeasonId,
		seasonName: newSeasonName,
		// Date in the YYYY-MM-DD format
		startDate: tomorrowStr,
		durationInDays: 14,
		resourceStat: pickStat(config.configuration.resourceStats),
		constructedStat: pickStat(config.configuration.constructedStats),
		battlegroundsStat: pickStat(config.configuration.battlegroundsStats),
	};
	console.debug('new season', newSeason);
	seasons.push(newSeason);
	await s3.writeFile(seasons, BUCKET, LOTTERY_SEASONS_FILE);

	const text = `New season started
		${JSON.stringify(newSeason, null, 4)}
	`;

	const params: SES.Types.SendEmailRequest = {
		Destination: {
			ToAddresses: ['seb@firestoneapp.com'],
		},
		Message: {
			Subject: {
				Charset: 'UTF-8',
				Data: 'Lottery new season',
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
	await new SES({ apiVersion: '2010-12-01' }).sendEmail(params).promise();

	cleanup();
	return { statusCode: 200, body: '' };
};

const pickStat = (stats: readonly LotteryConfigStat[]): LotteryStat => {
	const stat = stats[Math.floor(Math.random() * stats.length)];
	const points = Math.floor(Math.random() * (stat.pointsMax - stat.pointsMin)) + stat.pointsMin;
	// Round the points to the nearest step
	const roundedPoints = Math.round(points / stat.step) * stat.step;
	return {
		type: stat.type,
		points: roundedPoints,
	};
};

interface LotterySeason {
	id: number;
	seasonName: string;
	startDate: string;
	durationInDays: number;
	resourceStat: LotteryStat;
	constructedStat: LotteryStat;
	battlegroundsStat: LotteryStat;
}

interface LotteryStat {
	type: string;
	points: number;
}

interface LotteryConfig {
	configuration: {
		resourceStats: readonly LotteryConfigStat[];
		constructedStats: readonly LotteryConfigStat[];
		battlegroundsStats: readonly LotteryConfigStat[];
	};
}

interface LotteryConfigStat {
	type: string;
	pointsMin: number;
	pointsMax: number;
	step: number;
}
