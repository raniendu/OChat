import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const vaultPath = process.argv[2] ?? process.env.OBSIDIAN_VAULT;

if (!vaultPath) {
	throw new Error('Pass a vault path or set OBSIDIAN_VAULT. Example: npm run install-local -- "/path/to/Vault"');
}

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
	if (!existsSync(file)) {
		throw new Error(`Missing ${file}. Run npm run build before installing locally.`);
	}
}

const pluginDir = join(resolve(vaultPath), '.obsidian', 'plugins', 'ochat');
mkdirSync(pluginDir, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
	copyFileSync(file, join(pluginDir, file));
}

console.log(`Installed OChat to ${pluginDir}`);
