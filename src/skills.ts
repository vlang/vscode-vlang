import { execFile as _execFile } from "child_process"
import { promisify } from "util"
import * as vscode from "vscode"
import { ExtensionContext, WorkspaceFolder } from "vscode"
import { log } from "./logger"
import {
	parseSkillList,
	SkillCatalog,
	SkillScope,
	skillAddArgs,
	skillState,
	skillUpdateArgs,
	summarize,
} from "./skillsProbe"
import { vCommandFor } from "./vExecutable"

const execFile = promisify(_execFile)

/** How long to wait for `v skills list` before giving up on this compiler. */
const timeoutMs = 15_000

interface Run {
	stdout: string
	stderr: string
	code: number
}

/** Run a `v` subcommand for a folder.
 *
 * `v skills` resolves a project install against the working directory, so the
 * folder's own path is the working directory rather than an argument.
 */
async function runV(
	vCommand: string,
	folder: WorkspaceFolder,
	args: string[],
): Promise<Run> {
	try {
		const { stdout, stderr } = await execFile(vCommand, args, {
			cwd: folder.uri.fsPath,
			timeout: timeoutMs,
		})
		return { stdout, stderr, code: 0 }
	} catch (error) {
		// A non-zero exit still prints what it said, and that text is the useful part.
		const failure = error as { stdout?: string; stderr?: string; code?: number }
		return {
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? String(error),
			code: failure.code ?? 1,
		}
	}
}

/** Read the catalog, or `undefined` when this compiler has no `v skills`. */
async function catalogFor(
	vCommand: string,
	folder: WorkspaceFolder,
): Promise<SkillCatalog | undefined> {
	const run = await runV(vCommand, folder, ["skills", "list"])
	const catalog = parseSkillList(run.stdout)
	if (!catalog) {
		log(`No V skills in ${vCommand}: ${run.stderr || run.stdout}`)
	}
	return catalog
}

function activeFolder(): WorkspaceFolder | undefined {
	const editor = vscode.window.activeTextEditor
	const folder = editor
		? vscode.workspace.getWorkspaceFolder(editor.document.uri)
		: undefined
	return folder ?? vscode.workspace.workspaceFolders?.[0]
}

/** Report a `v skills` run, showing whatever it said rather than a summary of it. */
async function report(title: string, run: Run): Promise<void> {
	const lines = [run.stdout.trim(), run.stderr.trim()].filter((line) => line !== "")
	await vscode.window.showInformationMessage(
		lines.length > 0 ? `${title}\n${lines.join("\n")}` : title,
	)
}

/** `V: Show V Agent Skill Status` */
async function showStatus(): Promise<void> {
	const folder = activeFolder()
	if (!folder) {
		void vscode.window.showErrorMessage("Open a folder to inspect its V skills.")
		return
	}
	const vCommand = vCommandFor(folder)
	const catalog = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: "Reading V agent skills..." },
		() => catalogFor(vCommand, folder),
	)
	if (!catalog) {
		void vscode.window.showWarningMessage(
			`This V has no \`v skills\`. ${vCommand} may be older than the feature.`,
		)
		return
	}

	const summary = summarize(catalog)
	const parts = [
		`${summary.installed} of ${catalog.skills.length} V agent skills installed`,
	]
	if (summary.stale > 0) {
		parts.push(`${summary.stale} out of date`)
	}
	if (summary.absent.length > 0) {
		parts.push(`${summary.absent.length} not installed`)
	}
	const choice = await vscode.window.showInformationMessage(
		parts.join(", "),
		...(summary.stale > 0 ? ["Update"] : []),
		"Details",
	)
	if (choice === "Update") {
		await updateSkills(folder, vCommand, catalog)
		return
	}
	if (choice !== "Details") {
		return
	}

	// `v skills list` prints the descriptions, which are what an agent routes on,
	// and they are long. A document is a better place for them than a notification.
	const document = await vscode.workspace.openTextDocument({
		language: "markdown",
		content: renderCatalog(catalog),
	})
	await vscode.window.showTextDocument(document, { preview: true })
}

function renderCatalog(catalog: SkillCatalog): string {
	const lines = [
		"# V agent skills",
		"",
		`Bundled in ${catalog.bundledRoot}`,
		"",
		`Project: ${catalog.projectDir}`,
		`User: ${catalog.globalDir}`,
		"",
	]
	for (const entry of catalog.skills) {
		const state = skillState(entry)
		const where = [
			state.project ? "project" : "",
			state.global ? "user" : "",
			state.stale ? "out of date" : "",
		]
			.filter((part) => part !== "")
			.join(", ")
		lines.push(`## ${entry.name}`, "", `- ${where || "not installed"}`, "", entry.description, "")
	}
	return lines.join("\n")
}

/** `V: Update V Agent Skills` */
async function updateSkills(
	folder: WorkspaceFolder,
	vCommand: string,
	catalog?: SkillCatalog,
): Promise<void> {
	const known = catalog ?? (await catalogFor(vCommand, folder))
	if (!known) {
		void vscode.window.showWarningMessage("This V has no `v skills`.")
		return
	}
	const scope = await pickScope(catalog?.projectDir ?? folder.uri.fsPath)
	if (!scope) {
		return
	}
	const run = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "Updating V agent skills..." },
		() => runV(vCommand, folder, skillUpdateArgs(scope)),
	)
	await report(`V skills update finished (exit ${run.code}).`, run)
}

async function pickScope(projectDir: string): Promise<SkillScope | undefined> {
	const choice = await vscode.window.showQuickPick(
		[
			{
				label: "This project",
				description: projectDir,
				detail: "Installed into the repository and shared with your team.",
				scope: "project" as SkillScope,
			},
			{
				label: "All my projects",
				description: "~/.agents/skills",
				detail: "Applies to every project on this machine. Written outside the workspace.",
				scope: "global" as SkillScope,
			},
		],
		{ title: "Where should the V agent skills go?" },
	)
	return choice?.scope
}

/** `V: Install V Agent Skills` */
async function installSkills(): Promise<void> {
	const folder = activeFolder()
	if (!folder) {
		void vscode.window.showErrorMessage("Open a folder to install V agent skills into.")
		return
	}
	const vCommand = vCommandFor(folder)
	const catalog = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: "Reading V agent skills..." },
		() => catalogFor(vCommand, folder),
	)
	if (!catalog) {
		void vscode.window.showWarningMessage(
			`This V has no \`v skills\`. ${vCommand} may be older than the feature.`,
		)
		return
	}

	const scope = await pickScope(folder.uri.fsPath)
	if (!scope) {
		return
	}

	// `description` is the only part an agent sees before deciding to load a skill,
	// so it is the only part worth showing in a picker.
	const items = catalog.skills.map((entry) => {
		const state = skillState(entry)
		const installed = state.project || state.global
		return {
			label: entry.name,
			description: installed ? "already installed" : "not installed",
			picked: !installed || state.stale,
			detail: entry.description,
		}
	})
	const chosen = await vscode.window.showQuickPick(items, {
		title: "Which V agent skills should be installed?",
		canPickMany: true,
	})
	if (!chosen || chosen.length === 0) {
		return
	}

	// A skill already installed is only overwritten when it has fallen behind the
	// compiler's copy. `add` refuses otherwise, so this is the one case where
	// `--force` is what the user asked for by picking the skill at all.
	const names = chosen.map((item) => item.label)
	const force = chosen.some((item) => item.description === "already installed")
	const run = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: "Installing V agent skills..." },
		() => runV(vCommand, folder, skillAddArgs(names, scope, force)),
	)
	await report(`V skills install finished (exit ${run.code}).`, run)
}

/** Offer the compiler's skills from the editor.
 *
 * The skills themselves are not contributed to VS Code. `.agents/skills` is an
 * open standard that Copilot, Claude Code and opencode already read, so bundling
 * a copy here would put the same skill in the catalog twice, competing for the
 * same trigger, with two different vintages of the same advice.
 */
export function registerSkillCommands(context: ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("v.skills.install", () => installSkills()),
		vscode.commands.registerCommand("v.skills.status", () => showStatus()),
		vscode.commands.registerCommand("v.skills.update", () => {
			const folder = activeFolder()
			if (!folder) {
				void vscode.window.showErrorMessage("Open a folder to update its V agent skills.")
				return undefined
			}
			return updateSkills(folder, vCommandFor(folder))
		}),
	)
}
