//@ts-check
"use strict";

const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const res = esbuild.buildSync({
	platform: "node",
	entryPoints: ["./src/extension.ts"],
	outdir: path.resolve(__dirname, "out"),
	external: ["vscode", "vscode/*"],
	entryNames: "[name]",
	format: "cjs",
	sourcemap: "external",
	logLevel: "info",
	bundle: true,
	minify:
		JSON.stringify(process.env.NODE_ENV || "development") ===
		JSON.stringify("production"),
	define: {
		"process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
	},
});
