import eslint from "@eslint/js"
import tseslint from "@typescript-eslint/eslint-plugin"
import tsparser from "@typescript-eslint/parser"
import globals from "globals"

export default [
	{
		// ignore generated and dependency folders
		ignores: ["node_modules/**", "out/**", "src/test/**"],
	},
	eslint.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.node,
			},
		},
		plugins: {
			"@typescript-eslint": tseslint,
		},
		rules: {
			...tseslint.configs.recommended.rules,
			...tseslint.configs["recommended-type-checked"].rules,
			// Custom rules from old config
			"prefer-const": "error",
			"no-array-constructor": "error",
			"no-new-object": "error",
			"no-shadow": "error",
			"no-undef-init": "error",
			"no-var": "error",
			"object-shorthand": "error",
			"prefer-template": "error",
			// Stylistic rules
			"array-bracket-spacing": "error",
			"brace-style": "error",
			"block-spacing": "error",
			camelcase: "error",
			"comma-spacing": "error",
			"eol-last": "error",
			"func-call-spacing": "error",
			quotes: ["error", "double"],
			semi: ["error", "never"],
			"no-extra-semi": "error",
		},
	},
]
