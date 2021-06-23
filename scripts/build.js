#!/usr/bin/env node
//@ts-check
'use strict';

const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');
const isProd = process.env.NODE_ENV === 'production';

esbuild.build({
	platform: 'node',
	entryPoints: ['./src/extension.ts'],
	outdir: './out',
	external: ['vscode'],
	format: 'cjs',
	sourcemap: 'external',
	bundle: true,
	minify: isProd,
	watch: {
		onRebuild(error, result) {
			if (error) console.error('watch build failed');
			else console.log('watch build succeeded');
		},
	},
}).then(res => {
	if (!isWatch) {
		res.stop();
	}
});
