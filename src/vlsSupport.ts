import { readManagedToolInstallation, type ManagedToolInstallation } from "./toolInstallation"
import { MIN_VLS_REVISION, VLS_SUPPORT_BASELINE } from "./toolSupport"

export class UnsupportedVlsError extends Error {
	constructor() {
		super(
			`This extension requires VLS ${MIN_VLS_REVISION.slice(0, 7)} or newer, installed and verified by V: Install or Update VLS. Older or unversioned external binaries are unsupported.`,
		)
	}
}

/** Upstream's fixed serverInfo version cannot identify the V3 implementation. */
export async function requireSupportedVls(
	executable: string,
	storageRoot: string,
): Promise<ManagedToolInstallation> {
	const installation = await readManagedToolInstallation(executable, "vls", storageRoot)
	if (installation?.vlsBaseline !== VLS_SUPPORT_BASELINE) throw new UnsupportedVlsError()
	return installation
}
