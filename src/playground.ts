/** Sharing code on the V playground.
 *
 * Everything here is vscode-free so the HTTP contract can be tested
 * without an editor: the server takes the code as a `code` form field
 * and answers `{hash, error}`, and a shared snippet lives at
 * `https://play.vlang.io/p/<hash>` (see `buildShareLink` in the
 * playground frontend). The editor wiring lives in `commands.ts`.
 */

const playgroundRoot = "https://play.vlang.io"

/** The link a shared snippet lives at. */
export function playgroundShareLink(hash: string): string {
	return `${playgroundRoot}/p/${hash}`
}

interface ShareCodeResponse {
	hash?: unknown
	error?: unknown
}

/** Share code on the playground, resolving to its link.
 *
 * `post` defaults to the global fetch and exists so tests can inject
 * a fake. A failure names its cause: unreachable server, HTTP status,
 * unparseable answer, or the server's own error.
 */
export async function sharePlaygroundCode(
	code: string,
	post: typeof fetch = fetch,
): Promise<string> {
	let response: Response
	try {
		const form = new FormData()
		form.append("code", code)
		response = await post(`${playgroundRoot}/share`, { method: "POST", body: form })
	} catch (error) {
		throw new Error(`Could not reach the playground: ${String(error)}`)
	}
	let result: ShareCodeResponse
	try {
		result = (await response.json()) as ShareCodeResponse
	} catch {
		throw new Error(
			`The playground answered ${response.status}, which is not a share response.`,
		)
	}
	if (!response.ok) {
		throw new Error(
			typeof result.error === "string" && result.error !== ""
				? result.error
				: `The playground answered ${response.status}.`,
		)
	}
	if (typeof result.hash !== "string" || result.hash === "") {
		throw new Error(
			typeof result.error === "string" && result.error !== ""
				? result.error
				: "The playground shared without answering a hash.",
		)
	}
	return playgroundShareLink(result.hash)
}
