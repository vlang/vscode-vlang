export interface ProcessCommand {
	args: string[]
	command: string
	windowsVerbatimArguments?: boolean
}

const windowsCommandMetaCharacters = /([()\][%!^"`<>&|;, *?])/g

function escapeWindowsCommand(value: string): string {
	return value.replace(windowsCommandMetaCharacters, "^$1")
}

function escapeWindowsArgument(value: string): string {
	let quoted = "\""
	let backslashes = 0
	for (const character of value) {
		if (character === "\\") {
			backslashes++
			continue
		}
		if (character === "\"") {
			quoted += `${"\\".repeat(backslashes * 2 + 1)  }"`
		} else {
			quoted += "\\".repeat(backslashes) + character
		}
		backslashes = 0
	}
	quoted += `${"\\".repeat(backslashes * 2)  }"`
	return quoted.replace(windowsCommandMetaCharacters, "^$1")
}

export function processLaunchCommand(
	command: string,
	args: string[],
	platform = process.platform,
	commandInterpreter = process.env.ComSpec || process.env.COMSPEC,
): ProcessCommand {
	if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(command)) {
		return { command, args: [...args] }
	}
	const commandLine = [escapeWindowsCommand(command), ...args.map(escapeWindowsArgument)].join(
		" ",
	)
	return {
		command: commandInterpreter || "cmd.exe",
		args: ["/d", "/s", "/c", `"${commandLine}"`],
		windowsVerbatimArguments: true,
	}
}

export function processTreeKillCommand(
	processId: number,
	platform = process.platform,
): ProcessCommand | undefined {
	if (platform !== "win32") {
		return undefined
	}
	return {
		command: "taskkill.exe",
		args: ["/pid", String(processId), "/t", "/f"],
	}
}

export function isTerminalInterrupt(data: string): boolean {
	return data.includes("\x03")
}
