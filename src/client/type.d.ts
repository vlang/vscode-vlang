import { SymbolKind } from "vscode";

export declare interface VSymbolInput {
	filepath: string;
	source: string;
}

declare enum Colors {
	red,
	blue,
	color,
}

export declare interface VTokenPosition {
	line_nr: number;
	pos: number;
	len: number;
}

export declare interface VSymbolFile {
	path: string;
	modname: string;
	symbols: VSymbolInfo[];
	has_error: boolean;
}

export declare interface VSymbolInfo {
	name: string;
	// signature: string;
	pos: { line: number; column: number };
	real_pos: VTokenPosition;
	body_pos: VTokenPosition;
	kind: SymbolKind;
	parent_idx: number;
}
