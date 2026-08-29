export interface PathLabel {
	folder: string;
	name: string;
}

/**
 * Splits a vault path into a dimmable folder prefix and the file name.
 * The chip that renders this lets the folder truncate first so the file
 * name survives at sidebar width.
 */
export function splitPathLabel(path: string): PathLabel {
	const trimmed = path.trim();
	const index = trimmed.lastIndexOf('/');

	if (index === -1) {
		return { folder: '', name: trimmed };
	}

	return {
		folder: trimmed.slice(0, index + 1),
		name: trimmed.slice(index + 1)
	};
}
