import type { EndpointClassification } from '../types';

export function classifyEndpoint(rawUrl: string): EndpointClassification {
	try {
		const url = new URL(rawUrl);
		const hostname = url.hostname.toLowerCase();

		if (isLocalhost(hostname)) {
			return {
				kind: 'localhost',
				requiresAcknowledgement: false,
				reason: 'Endpoint is local to this device.'
			};
		}

		if (isPrivateLanHost(hostname)) {
			return {
				kind: 'private-lan',
				requiresAcknowledgement: false,
				reason: 'Endpoint is on a private network.'
			};
		}

		return {
			kind: 'public',
			requiresAcknowledgement: true,
			reason: 'Public endpoints may receive note and vault context.'
		};
	} catch {
		return {
			kind: 'invalid',
			requiresAcknowledgement: true,
			reason: 'Endpoint URL is invalid.'
		};
	}
}

function isLocalhost(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function isPrivateLanHost(hostname: string): boolean {
	const parts = hostname.split('.').map((part) => Number(part));

	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return hostname.endsWith('.local');
	}

	const [first, second] = parts;

	return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
