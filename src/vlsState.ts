/** Where the V language server is in its lifecycle, as the extension reports it. */
export type VlsStatus = "disabled" | "starting" | "active" | "stopped" | "error"

export interface StatusPresentation {
	/** Status bar text, using ThemeIcon codicons. */
	text: string
	tooltip: string
}

/** Describe `status` for a status bar entry.
 *
 * Activation used to raise two information messages on every window open, which
 * is noise for a background service that is usually working. A status bar entry
 * says the same thing without interrupting, and stays visible when it fails.
 */
export function presentVlsStatus(status: VlsStatus): StatusPresentation {
	switch (status) {
		case "starting":
			return { text: "$(loading~spin) V", tooltip: "V Language Server is starting." }
		case "active":
			return { text: "$(check) V", tooltip: "V Language Server is active." }
		case "stopped":
			return { text: "$(circle-slash) V", tooltip: "V Language Server is stopped." }
		case "error":
			return { text: "$(error) V", tooltip: "V Language Server failed to start." }
		case "disabled":
			return { text: "$(circle-slash) V", tooltip: "V Language Server is disabled." }
	}
}

/** The `workspace/didChangeConfiguration` payload the V language server expects.
 *
 * VLS reads its settings under a `vls` key, but this extension configures them
 * under `v.vls`, so the payload is built by hand rather than sent through
 * `synchronize.configurationSection`. A setting added to the manifest has to be
 * added here too; `vlsServerSettings` exists so that omission is a test failure
 * rather than a setting that silently stays at its default.
 */
export interface VlsServerSettings {
	vls: {
		inlayHints: { enabled: boolean }
		diagnostics: { enabled: boolean }
	}
}

export function vlsServerSettings(inlayHints: boolean, diagnostics: boolean): VlsServerSettings {
	return {
		vls: {
			inlayHints: { enabled: inlayHints },
			diagnostics: { enabled: diagnostics },
		},
	}
}
