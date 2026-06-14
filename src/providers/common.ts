import type { RequestDescriptor } from '../types';

export function joinUrl(baseUrl: string, path: string): string {
	const base = baseUrl.trim().replace(/\/+$/, '');
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}${suffix}`;
}

export function postJson(url: string, body: unknown): RequestDescriptor {
	return {
		url,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body
	};
}

export function getJson(url: string): RequestDescriptor {
	return {
		url,
		method: 'GET'
	};
}
