/* eslint-disable @typescript-eslint/no-use-before-define */

import { Sqs } from '@firestone-hs/aws-lambda-utils';
import { LotteryInput } from './public-api';

const sqs = new Sqs();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	const headers = {
		'Access-Control-Allow-Headers':
			'Accept,Accept-Language,Content-Language,Content-Type,Authorization,x-correlation-id,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
		'Access-Control-Expose-Headers': 'x-my-header-out',
		'Access-Control-Allow-Methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
		'Access-Control-Allow-Origin': event.headers?.Origin || event.headers?.origin || '*',
	};
	// Preflight
	if (!event.body) {
		const response = {
			statusCode: 200,
			body: null,
			headers: headers,
		};
		return response;
	}

	// console.debug('received event', event);
	const input: LotteryInput = JSON.parse(event.body);
	await sqs.sendMessageToQueue(input, process.env.SQS_URL);
	return {
		statusCode: 200,
		headers: headers,
		body: '',
	};
};
