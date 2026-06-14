const MAX_FUZZY_MENTION_MATCHES = 3;

export function extractContextMentions(input: string): string[] {
	const mentions: string[] = [];
	let index = 0;

	while (index < input.length) {
		const atIndex = input.indexOf('@', index);
		if (atIndex === -1) {
			break;
		}

		if (!isMentionBoundary(input, atIndex)) {
			index = atIndex + 1;
			continue;
		}

		const parsed = parseMentionAt(input, atIndex);
		if (parsed) {
			mentions.push(parsed.query);
			index = parsed.end;
			continue;
		}

		index = atIndex + 1;
	}

	return [...new Set(mentions.map(cleanMentionQuery).filter((mention) => mention.length > 0))];
}

export function resolveMentionedMarkdownPaths(input: string, markdownPaths: string[]): string[] {
	const paths: string[] = [];

	for (const mention of extractContextMentions(input)) {
		const exact = findExactMarkdownPath(mention, markdownPaths);
		const matches = exact ? [exact] : findMarkdownPathMatches(mention, markdownPaths, MAX_FUZZY_MENTION_MATCHES);
		for (const match of matches) {
			if (!paths.includes(match)) {
				paths.push(match);
			}
		}
	}

	return paths;
}

export function findMarkdownPathMatches(query: string, markdownPaths: string[], limit: number): string[] {
	const normalizedQuery = normalizePathish(cleanMentionQuery(query));
	const candidates = markdownPaths.filter((path) => path.toLowerCase().endsWith('.md'));

	if (normalizedQuery.length === 0) {
		return candidates.sort((a, b) => a.localeCompare(b)).slice(0, limit);
	}

	return candidates
		.map((path) => ({
			path,
			score: scoreMarkdownPath(path, normalizedQuery)
		}))
		.filter((candidate) => candidate.score > 0)
		.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
		.slice(0, limit)
		.map((candidate) => candidate.path);
}

function parseMentionAt(input: string, atIndex: number): { query: string; end: number } | null {
	if (input.startsWith('@[[', atIndex)) {
		const end = input.indexOf(']]', atIndex + 3);
		return end === -1 ? null : { query: input.slice(atIndex + 3, end), end: end + 2 };
	}

	if (input.startsWith('@"', atIndex)) {
		const end = input.indexOf('"', atIndex + 2);
		return end === -1 ? null : { query: input.slice(atIndex + 2, end), end: end + 1 };
	}

	let end = atIndex + 1;
	while (end < input.length && !/\s/.test(input[end])) {
		end++;
	}

	return end === atIndex + 1 ? null : { query: input.slice(atIndex + 1, end), end };
}

function findExactMarkdownPath(query: string, markdownPaths: string[]): string | null {
	const normalizedQuery = normalizePathish(cleanMentionQuery(query));

	return (
		markdownPaths.find((path) => {
			const normalizedPath = normalizePathish(path);
			const normalizedBase = normalizePathish(baseName(path));
			return (
				normalizedPath === normalizedQuery ||
				stripMarkdownExtension(normalizedPath) === stripMarkdownExtension(normalizedQuery) ||
				normalizedBase === normalizedQuery ||
				stripMarkdownExtension(normalizedBase) === stripMarkdownExtension(normalizedQuery)
			);
		}) ?? null
	);
}

function scoreMarkdownPath(path: string, normalizedQuery: string): number {
	const normalizedPath = normalizePathish(path);
	const normalizedBase = normalizePathish(baseName(path));
	const pathWithoutExtension = stripMarkdownExtension(normalizedPath);
	const baseWithoutExtension = stripMarkdownExtension(normalizedBase);
	const pathSegments = pathWithoutExtension.split('/');
	const baseWords = baseWithoutExtension.split(/[^a-z0-9]+/).filter(Boolean);
	const queryVariants = getQueryVariants(normalizedQuery);

	if (normalizedPath === normalizedQuery || pathWithoutExtension === stripMarkdownExtension(normalizedQuery)) {
		return 1000;
	}

	if (normalizedBase === normalizedQuery || baseWithoutExtension === stripMarkdownExtension(normalizedQuery)) {
		return 950;
	}

	if (baseWords.some((word) => queryVariants.includes(word))) {
		return 900;
	}

	if (pathSegments.some((segment) => queryVariants.includes(segment))) {
		return 850;
	}

	if (baseWords.some((word) => queryVariants.some((query) => word.startsWith(query)))) {
		return 800;
	}

	if (pathSegments.some((segment) => queryVariants.some((query) => segment.startsWith(query)))) {
		return 700;
	}

	if (queryVariants.some((query) => baseWithoutExtension.includes(query))) {
		return 600;
	}

	if (queryVariants.some((query) => pathWithoutExtension.includes(query))) {
		return 500;
	}

	return 0;
}

function getQueryVariants(query: string): string[] {
	const variants = [query];

	if (query.endsWith('e') && query.length > 3) {
		variants.push(query.slice(0, -1));
	}

	return [...new Set(variants)];
}

function isMentionBoundary(input: string, atIndex: number): boolean {
	if (atIndex === 0) {
		return true;
	}

	return /[\s([{:]/.test(input[atIndex - 1]);
}

function cleanMentionQuery(query: string): string {
	return query.trim().replace(/[.,;:!?)]$/g, '');
}

function normalizePathish(value: string): string {
	return value.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function stripMarkdownExtension(value: string): string {
	return value.endsWith('.md') ? value.slice(0, -3) : value;
}

function baseName(path: string): string {
	return path.split('/').pop() ?? path;
}
