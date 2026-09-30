import { window } from "vscode"

export const outputChannel = window.createOutputChannel("V", { log: true })
export const vlsOutputChannel = window.createOutputChannel("V Language Server", { log: true })
