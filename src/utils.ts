import { env, Uri, window } from "vscode"
import { executeV } from "./exec"
import { outputChannel } from "./logger"

/** Whether the V compiler answers, through the configured executable path. */
export async function isVInstalled(): Promise<boolean> {
	try {
		await executeV(["version"])
		return true
	} catch (error) {
		outputChannel.info(`V compiler not detected: ${String(error)}`)
		return false
	}
}

/**
 * Point at the V installation instructions. A managed install belongs to the
 * tool manager, which this activation does not construct, so this clones and
 * builds nothing.
 */
export async function installV(): Promise<void> {
	const action = await window.showInformationMessage(
		"Install V from vlang.io, then reload this window.",
		"Open vlang.io",
	)
	if (action === "Open vlang.io") {
		await env.openExternal(Uri.parse("https://vlang.io"))
	}
}
