import {
	isSupportedVlsVersion,
	MIN_VLS_VERSION,
	readVlsIdentity,
	type VlsIdentity,
	type VlsVersionOptions,
} from "./toolVersions"

export class UnsupportedVlsError extends Error {
	constructor() {
		super(
			`This extension requires VLS ${MIN_VLS_VERSION} or newer, as reported by \`vls --version\`. Use V: Install or Update VLS to update an older or unidentifiable installation.`,
		)
	}
}

export interface VlsSupportOptions extends VlsVersionOptions {
	signal?: AbortSignal
	readIdentity?: typeof readVlsIdentity
}

/** External and managed servers alike are supported by the version they report. */
export async function requireSupportedVls(
	executable: string,
	options: VlsSupportOptions = {},
): Promise<VlsIdentity> {
	const { signal, readIdentity = readVlsIdentity } = options
	signal?.throwIfAborted()
	const identity = await readIdentity(executable, signal, options)
	signal?.throwIfAborted()
	if (identity && isSupportedVlsVersion(identity.version)) return identity
	throw new UnsupportedVlsError()
}
