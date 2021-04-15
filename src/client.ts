import { LanguageClient } from "vscode-languageclient/lib/node/main";

export let clients = new Map<string, LanguageClient>();
export const ENABLE_VLS_BY_DEFAULT = false;
