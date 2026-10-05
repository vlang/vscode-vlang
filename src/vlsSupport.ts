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

/** Support could not be established either way, typically because GitHub is unreachable. */
export class VlsVerificationUnavailableError extends Error {
	constructor(revision: string, cause: unknown) {
		super(
			`Could not verify that VLS ${revision.slice(0, 7)} includes ${MIN_VLS_REVISION.slice(0, 7)}: ${cause instanceof Error ? cause.message : String(cause)} Run V: Restart VLS when GitHub is reachable, or use V: Install or Update VLS.`,
			{ cause },
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
	let supported: boolean
	try {
		supported = await isSupportedVlsRevision(executable, revision, signal, fetcher)
	} catch (error) {
		signal?.throwIfAborted()
		throw new VlsVerificationUnavailableError(revision!, error)
	}
	if (supported) return { ...identity, revision }
	signal?.throwIfAborted()
	throw new UnsupportedVlsError()
}
