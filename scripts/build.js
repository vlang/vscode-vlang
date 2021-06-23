#!/usr/bin/env node
//@ts-check
'use strict';

const esbuild = require('esbuild');

esbuild.buildSync({
	platform: 'node',
	entryPoints: ['./src/extension.ts'],
	outdir: './out',
	external: ["vscode"],
	format: 'cjs',
	sourcemap: 'external',
	bundle: true,
	minify: process.env.NODE_ENV === 'production',
});
