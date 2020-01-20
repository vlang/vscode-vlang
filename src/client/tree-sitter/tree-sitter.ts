import * as Parser from 'web-tree-sitter';
import * as path from 'path';
import * as scopes from './scopes';
import * as colors from './colors';
import * as vscode from 'vscode';
import { vLanguageId } from '../extension';

const treeSitter: { parser?: Parser, color: colors.ColorFunction } = {
	color: colors.colorSyntax
}

export function activateTreeSitter(context: vscode.ExtensionContext) {
	// Activate the tree-sitter
	console.log("Activating tree-sitter...");
	// Parse of all visible documents
	const trees: { [uri: string]: Parser.Tree } = {}
	async function open(editor: vscode.TextEditor) {
		if (editor.document.languageId != vLanguageId) return;
		if (editor.document.languageId == vLanguageId) {
			const absolute = path.join(context.extensionPath, 'parsers', 'tree-sitter-v.wasm');
			const wasm = path.relative(process.cwd(), absolute);
			const lang = await Parser.Language.load(wasm);
			const parser = new Parser();
			parser.setLanguage(lang);
			treeSitter.parser = parser;
		}

		const t = treeSitter.parser.parse(editor.document.getText()) // TODO don't use getText, use Parser.Input
		trees[editor.document.uri.toString()] = t;
		colorUri(editor.document.uri);
	}
	// NOTE: if you make this an async function, it seems to cause edit anomalies
	function edit(edit: vscode.TextDocumentChangeEvent) {
		if (edit.document.languageId != vLanguageId || treeSitter.parser == null) return;
		updateTree(treeSitter.parser, edit);
		colorUri(edit.document.uri);
	}
	function updateTree(parser: Parser, edit: vscode.TextDocumentChangeEvent) {
		if (edit.contentChanges.length == 0) return;
		const old = trees[edit.document.uri.toString()];
		for (const e of edit.contentChanges) {
			const startIndex = e.rangeOffset;
			const oldEndIndex = e.rangeOffset + e.rangeLength
			const newEndIndex = e.rangeOffset + e.text.length;
			const startPos = edit.document.positionAt(startIndex);
			const oldEndPos = edit.document.positionAt(oldEndIndex);
			const newEndPos = edit.document.positionAt(newEndIndex);
			const startPosition = asPoint(startPos);
			const oldEndPosition = asPoint(oldEndPos);
			const newEndPosition = asPoint(newEndPos);
			const delta = { startIndex, oldEndIndex, newEndIndex, startPosition, oldEndPosition, newEndPosition };
			old.edit(delta);
		}
		const t = parser.parse(edit.document.getText(), old) // TODO don't use getText, use Parser.Input
		trees[edit.document.uri.toString()] = t;
	}
	function asPoint(pos: vscode.Position): Parser.Point {
		return { row: pos.line, column: pos.character };
	}
	function close(doc: vscode.TextDocument) {
		delete trees[doc.uri.toString()];
	}
	function colorUri(uri: vscode.Uri) {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri == uri) {
				colorEditor(editor);
			}
		}
	}
	const warnedScopes = new Set<string>()
	function colorEditor(editor: vscode.TextEditor) {
		const t = trees[editor.document.uri.toString()]
		if (t == null) return
		if (editor.document.languageId != vLanguageId) return
		const scopes = treeSitter.color(t, visibleLines(editor));
		for (const scope of scopes.keys()) {
			const dec = decoration(scope);
			if (dec) {
				const ranges = scopes.get(scope)!.map(range);
				editor.setDecorations(dec, ranges)
			} else if (!warnedScopes.has(scope)) {
				console.warn(scope, 'was not found in the current theme')
				warnedScopes.add(scope);
			}
		}
		for (const scope of decorationCache.keys()) {
			if (!scopes.has(scope)) {
				const dec = decorationCache.get(scope)!
				editor.setDecorations(dec, []);
			}
		}
	}
	async function colorAllOpen() {
		for (const editor of vscode.window.visibleTextEditors) {
			await open(editor);
		}
	}
	// Load active color theme
	async function onChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
		let colorizationNeedsReload: boolean = event.affectsConfiguration("workbench.colorTheme")
			|| event.affectsConfiguration("editor.tokenColorCustomizations");
		if (colorizationNeedsReload) {
			await loadStyles();
			colorAllOpen();
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(onChangeConfiguration),
		vscode.window.onDidChangeVisibleTextEditors(colorAllOpen),
		vscode.workspace.onDidChangeTextDocument(edit),
		vscode.workspace.onDidCloseTextDocument(close),
		vscode.window.onDidChangeTextEditorVisibleRanges(change => colorEditor(change.textEditor))
	);

	// Don't wait for the initial color, it takes too long to inspect the themes and causes VSCode extension host to hang
	async function activateLazily() {
		await loadStyles();
		await initParser;
		colorAllOpen();
	}
	activateLazily();
}

// Create decoration types from scopes lazily
const decorationCache = new Map<string, vscode.TextEditorDecorationType>();

export function decoration(scope: string): vscode.TextEditorDecorationType | undefined {
	// If we've already created a decoration for `scope`, use it
	if (decorationCache.has(scope)) {
		return decorationCache.get(scope);
	}
	// If `scope` is defined in the current theme, create a decoration for it
	const textmate = scopes.find(scope);
	if (textmate) {
		const decoration = createDecorationFromTextmate(textmate);
		decorationCache.set(scope, decoration);
		return decoration;
	}
	// Otherwise, give up, there is no color available for this scope
	return undefined;
}

function createDecorationFromTextmate(themeStyle: scopes.TextMateRuleSettings): vscode.TextEditorDecorationType {
	let options: vscode.DecorationRenderOptions = {};
	options.rangeBehavior = vscode.DecorationRangeBehavior.OpenOpen;
	if (themeStyle.foreground) {
		options.color = themeStyle.foreground;
	}
	if (themeStyle.background) {
		options.backgroundColor = themeStyle.background;
	}
	if (themeStyle.fontStyle) {
		let parts: string[] = themeStyle.fontStyle.split(" ");
		parts.forEach((part) => {
			switch (part) {
				case "italic":
					options.fontStyle = "italic";
					break;
				case "bold":
					options.fontWeight = "bold";
					break;
				case "underline":
					options.textDecoration = "underline";
					break;
				default:
					break;
			}
		})
	}
	return vscode.window.createTextEditorDecorationType(options);
}

// Load styles from the current active theme
async function loadStyles() {
	await scopes.load();
	// Clear old styles
	for (const style of decorationCache.values()) {
		style.dispose();
	}
	decorationCache.clear();
}

// For some reason this crashes if we put it inside activate
const initParser = Parser.init(); // TODO this isn't a field, suppress package member coloring like Go

function visibleLines(editor: vscode.TextEditor) {
	return editor.visibleRanges.map(range => {
		const start = range.start.line;
		const end = range.end.line;
		return { start, end };
	});
}

function range(x: colors.Range): vscode.Range {
	return new vscode.Range(x.start.row, x.start.column, x.end.row, x.end.column);
}

