import { Uri, workspace } from "vscode"

/** Keep settings from the former VLS extension effective during migration. */
export function migratedSetting<T>(
	section: string,
	key: string,
	legacySection: string,
	legacyKey: string,
	defaultValue: T,
	resource?: Uri,
): T {
	const configuration = workspace.getConfiguration(section, resource)
	const inspection = configuration.inspect<T>(key)
	if (
		inspection &&
		[
			inspection.globalValue,
			inspection.workspaceValue,
			inspection.workspaceFolderValue,
			inspection.globalLanguageValue,
			inspection.workspaceLanguageValue,
			inspection.workspaceFolderLanguageValue,
		].some((value) => value !== undefined)
	) {
		return configuration.get<T>(key, defaultValue)
	}
	return workspace.getConfiguration(legacySection, resource).get<T>(legacyKey, defaultValue)
}
