// ESLint flat config. `npm run lint` is `eslint src`, and the files glob below
// scopes it to TypeScript sources.
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"

export default [
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsParser,
			sourceType: "module",
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			quotes: ["error", "double", { avoidEscape: true }],
			semi: ["error", "never"],
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		},
	},
]
