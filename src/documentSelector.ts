/** Where V language features apply.
 *
 * Pure and vscode-free so the selector can be tested without an editor.
 * The entries are structurally compatible with vscode's DocumentSelector.
 */

export interface VDocumentFilter {
	readonly language: string
	readonly scheme: string
}

/**
 * Saved files, unsaved buffers, diff views, and the declared `v.mod`
 * language. A file-only selector leaves new files, `git` diff panes and
 * `v.mod` without any V features.
 */
export const vDocumentSelector: readonly VDocumentFilter[] = [
	{ language: "v", scheme: "file" },
	{ language: "v", scheme: "untitled" },
	{ language: "v", scheme: "git" },
	{ language: "v.mod", scheme: "file" },
	{ language: "v.mod", scheme: "untitled" },
	{ language: "v.mod", scheme: "git" },
]
