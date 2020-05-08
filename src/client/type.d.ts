declare interface ErrorInfo {
	file: string;
	line: number;
	column: number;
	message: string;
	stderr: string;
}

declare interface MoreInfo {
	for: number;
	content: string;
}
