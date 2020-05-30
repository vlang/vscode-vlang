#!/usr/bin/env node
// @ts-check
"use strict";

const { exec } = require("child_process");
const { writeFileSync } = require("fs");
const { resolve } = require("path");

const jsonFiles = [
	"../syntaxes/v.tmLanguage.json",
	"../language-configuration.json",
	"../snippets/snippets.json",
];

jsonFiles.forEach((jsonFile) => {
	const absolutePath = resolve(__dirname, jsonFile);
	exec("npx json-minify " + absolutePath, (error, stdout) => {
		if (!!error) throw error;
		const outputFile = absolutePath;
		// console.log(outputFile);
		writeFileSync(outputFile, stdout);
	});
});
