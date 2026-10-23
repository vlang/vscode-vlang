import {
	isSupportedVlsVersion,
	MIN_VLS_VERSION,
	readVlsIdentity,
	type VlsIdentity,
	type VlsVersionOptions,
} from "./toolVersions"

/** The server this extension is built against, and the only one it builds itself. */
const ownServerName = "vls"

function namesOwnServer(identity: VlsIdentity | undefined): boolean {
	return identity?.name?.toLowerCase() === ownServerName
}

function describeUnsupportedVls(executable: string, identity: VlsIdentity | undefined): string {
	const version = identity?.version
	if (!version) {
		return `Could not read a version from \`${executable} --version\`. This extension requires a language server that reports \`VLS <version>\` or \`<name> version <version>\` there, at version ${MIN_VLS_VERSION} or newer. Check the v.vls.command and v.vls.args settings.`
	}
	if (namesOwnServer(identity)) {
		return `\`${executable}\` reports VLS ${version}, and this extension requires ${MIN_VLS_VERSION} or newer. Use V: Install or Update VLS to update.`
	}
	// The name keeps the remedy pointed at the server the user chose.
	const server = identity?.name ? `${identity.name} ` : ""
	return `\`${executable}\` reports ${server}${version}, and this extension requires ${MIN_VLS_VERSION} or newer. Update it, or set v.vls.command to a server that reports a supported version.`
}

export class UnsupportedVlsError extends Error {
	/**
	 * Whether V: Install or Update VLS is a remedy for this rejection. It is not
	 * when the server could not be identified, or named itself something else:
	 * that command builds VLS in place of whatever `v.vls.command` names.
	 */
	readonly updatable: boolean

	constructor(
		readonly executable: string,
		readonly identity: VlsIdentity | undefined,
	) {
		super(describeUnsupportedVls(executable, identity))
		this.updatable = Boolean(identity?.version) && namesOwnServer(identity)
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
	throw new UnsupportedVlsError(executable, identity)
}
