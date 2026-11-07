import * as path from "path"

export type TemplateScriptKind = "html" | "js" | "jsx" | "tsx" | "ts"

export interface VebDirective {
	kind: "if" | "for" | "else" | "end" | "include" | "variable" | "interpolation"
	value: string
	line: number
}

/** A file is a V template when it uses a template extension or lives under templates/. */
export function isVebTemplateFile(fsPath: string): boolean {
	const lower = fsPath.toLowerCase().replace(/\\/g, "/")
	if (lower.endsWith(".vhtml") || lower.endsWith(".vtml")) return true
	if (!lower.endsWith(".html")) return false
	return lower.includes("/templates/")
}

/** Parse one line for a veb directive. Pure and testable. */
export function parseVebDirective(line: string, lineNumber: number): VebDirective | undefined {
	const trimmed = line.trim()
	let match = /^@(if|for|else|end)\b(.*)$/.exec(trimmed)
	if (match?.[1]) {
		const kind = match[1] as VebDirective["kind"]
		return { kind, value: (match[2] ?? "").trim(), line: lineNumber }
	}
	match = /^@include\s+['"]([^'"]+)['"]/.exec(trimmed)
	if (match?.[1]) {
		return { kind: "include", value: match[1], line: lineNumber }
	}
	const variable = /@([a-zA-Z_][\w.]*)/.exec(line)
	if (variable?.[1]) {
		return { kind: "variable", value: variable[1], line: lineNumber }
	}
	const interpolation = /\$\{([^}]+)\}|@\{([^}]+)\}/.exec(line)
	if (interpolation) {
		return {
			kind: "interpolation",
			value: (interpolation[1] ?? interpolation[2] ?? "").trim(),
			line: lineNumber,
		}
	}
	return undefined
}

/** Resolve a $veb.html('...') argument against the document and workspace. */
export function resolveVebTemplatePath(
	templateArg: string,
	documentDir: string,
	workspaceRoot: string,
): string {
	const cleaned = templateArg.trim().replace(/^['"]|['"]$/g, "")
	if (path.isAbsolute(cleaned)) {
		return path.normalize(cleaned)
	}
	const fromDocument = path.resolve(documentDir, cleaned)
	if (fromDocument.toLowerCase().includes(`${path.sep}templates${path.sep}`.toLowerCase())) {
		return fromDocument
	}
	const fromRootTemplates = path.resolve(workspaceRoot, "templates", cleaned)
	if (cleaned.startsWith("templates/") || cleaned.startsWith("templates\\")) {
		return path.resolve(workspaceRoot, cleaned)
	}
	// Prefer the workspace templates/ folder when the argument is a bare name.
	if (!cleaned.includes("/") && !cleaned.includes("\\")) {
		return fromRootTemplates
	}
	return fromDocument
}

/** Auto-detect JSX/TSX inside a template: extension first, then content markers. */
export function detectTemplateScriptKind(fileName: string, text: string): TemplateScriptKind {
	const lower = fileName.toLowerCase()
	if (lower.endsWith(".tsx")) return "tsx"
	if (lower.endsWith(".jsx")) return "jsx"
	if (lower.endsWith(".ts")) return "ts"
	if (
		/text\/babel|text\/jsx/i.test(text) ||
		/<[A-Z][\w]*\s[^>]*\{[^}]*\}/.test(text) ||
		/<>\s*[\s\S]*<\/>/.test(text)
	) {
		return lower.endsWith(".tsx") || /:\s*\w+(\[\])?\s*=/.test(text) ? "tsx" : "jsx"
	}
	if (/<script[^>]*>/i.test(text)) return "js"
	return "html"
}
