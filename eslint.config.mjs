import js from '@eslint/js';
import { globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import obsidian from 'eslint-plugin-obsidianmd';

export default tseslint.config(
	globalIgnores([
		'node_modules',
		'coverage',
		'main.js',
		'eslint.config.mjs',
		'esbuild.config.mjs',
		'vitest.config.ts',
		'version-bump.mjs',
		'scripts/install-local.mjs',
		'*.json'
	]),
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		languageOptions: {
			ecmaVersion: 2021,
			sourceType: 'module',
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			},
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			'no-console': ['error', { allow: ['warn', 'error'] }]
		}
	},
	...obsidian.configs.recommended,
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		rules: {
			'@typescript-eslint/no-deprecated': 'off'
		}
	}
);
