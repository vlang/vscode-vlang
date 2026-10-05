import { readManagedToolInstallation } from "./toolInstallation"
import {
	isSupportedVlsRevision,
	isSupportedVlsVersion,
	MIN_VLS_REVISION,
	MIN_VLS_VERSION,
	readVlsIdentity,
	VLS_SUPPORT_BASELINE,
	type GitHubFetch,
	type VlsIdentity,
	type VlsVersionOptions,
} from "./toolVersions"

export class UnsupportedVlsError extends Error {
	constructor() {
		super(
			`This extension requires VLS ${MIN_VLS_VERSION} or newer, or a verified build including ${MIN_VLS_REVISION.slice(0, 7)}. Use V: Install or Update VLS to update an older or unidentifiable installation.`,
		)
	}
}

export interface VlsSupportOptions extends VlsVersionOptions {
	signal?: AbortSignal
	fetcher?: GitHubFetch
	readIdentity?: typeof readVlsIdentity
}

/** Accept either supported CLI metadata or a verified managed source revision. */
export async function requireSupportedVls(
	executable: string,
	storageRoot: string,
	options: VlsSupportOptions = {},
): Promise<VlsIdentity> {
	const { signal, fetcher, readIdentity = readVlsIdentity } = options
	signal?.throwIfAborted()
	const installation = await readManagedToolInstallation(executable, "vls", storageRoot)
	signal?.throwIfAborted()
	if (
		installation &&
		(installation.revision === MIN_VLS_REVISION ||
			installation.vlsBaseline === VLS_SUPPORT_BASELINE)
	) {
		return { revision: installation.revision }
	}
	const identity = await readIdentity(executable, signal, options)
	signal?.throwIfAborted()
	if (identity && isSupportedVlsVersion(identity.version)) return identity
	// Unstamped managed metadata still proves which intact binary was built.
	const revision = installation?.revision ?? identity?.revision
	if (await isSupportedVlsRevision(executable, revision, signal, fetcher)) {
		return { ...identity, revision }
	}
	signal?.throwIfAborted()
	throw new UnsupportedVlsError()
}
