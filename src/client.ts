import { LanguageClient } from "vscode-languageclient/node";

export let client: LanguageClient | null = null;

export function setClient(_client: LanguageClient) {
	client = _client;
}
