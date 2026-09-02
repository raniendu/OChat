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

export function withBearerToken(request: RequestDescriptor, token: string): RequestDescriptor {
	const normalizedToken = token.trim();
	if (normalizedToken.length === 0) {
		return request;
	}

	return {
		...request,
		headers: {
			...request.headers,
			Authorization: `Bearer ${normalizedToken}`
		}
	};
}

export function resolveApiKeySecret(
	secretId: string,
	readSecret: (id: string) => string | null
): string | null {
	const normalizedSecretId = secretId.trim();
	if (normalizedSecretId.length === 0) {
		return null;
	}

	const token = readSecret(normalizedSecretId)?.trim();
	if (!token) {
		throw new Error(
			`API key secret "${normalizedSecretId}" was not found. Choose another secret in OChat settings.`
		);
	}

	return token;
}

export function normalizeProviderRequestError(error: unknown, hasSelectedSecret: boolean): Error {
	if (isUnauthorizedError(error)) {
		return new Error(
			hasSelectedSecret
				? 'Authentication failed (401). Check or replace the selected API key in OChat settings.'
				: 'Authentication failed (401). Select an API key in OChat settings and try again.'
		);
	}

	return error instanceof Error ? error : new Error(String(error));
}

function isUnauthorizedError(error: unknown): boolean {
	if (typeof error === 'object' && error !== null && 'status' in error && error.status === 401) {
		return true;
	}

	return error instanceof Error && /(?:\b401\b|unauthorized)/i.test(error.message);
}
