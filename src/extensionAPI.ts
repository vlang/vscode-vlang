import { Uri, workspace } from "vscode"
import { vCommandFor } from "./vExecutable"

/** The API this extension exposes to other extensions.
 *
 * `golang.go` exports a small surface so other extensions can resolve the
 * toolchain path without re-implementing the resolution. V has the same need: a
 * CI tooling extension, or a formatter that needs to know which `v` is live,
 * should not have to read `v.executablePath` and re-resolve it.
 *
 * Only what is already computed is exposed. There is no way to start VLS, run a
 * task or read a file through this surface, because each of those is a side
 * effect the caller did not ask for.
 */
export interface VExtensionAPI {
	/** The version of this API. */
	readonly version: 1
	/** Resolve the V compiler for a resource.
	 *
	 * Returns the absolute path to the `v` binary the extension would use for
	 * that resource, including the settings kept from the former VLS extension.
	 * Returns `undefined` when the compiler cannot be resolved, which is not the
	 * same as it being absent: the caller can then report a missing compiler
	 * rather than a blank setting.
	 */
	resolveV(resource?: Uri): string | undefined
}

export function createExtensionAPI(): VExtensionAPI {
	return {
		version: 1,
		resolveV(resource?: Uri): string | undefined {
			if (!resource) {
				return undefined
			}
			const folder = workspace.getWorkspaceFolder(resource)
			if (!folder) {
				return undefined
			}
			return vCommandFor(folder)
		},
	}
}
