#!/usr/bin/env node
// @ts-check
"use strict";

const { exec } = require("child_process");
const { writeFileSync } = require("fs");
const { resolve } = require("path");

const jsonFiles = [
	"v.tmLanguage.json",
	"language-configuration.json",
	"snippets.json",
];

jsonFiles.forEach((jsonFile) => {
	const inputFile  = resolve(__dirname + '/../conf/', jsonFile);
	const outputFile = resolve(__dirname + '/../out/', jsonFile);
	exec("npx json-minify " + inputFile, (error, stdout) => {
		if (!!error) throw error;
		writeFileSync(outputFile, stdout);
	});
});
