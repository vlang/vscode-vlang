import * as assert from "assert"
import { describe, it } from "node:test"
import type { ExtensionContext } from "vscode"
import { registerDocumentFormatting, serverShouldFormat } from "../formatProvider"
import { resetVscode, state } from "./fixtures/vscode"

/** The language server already answers formatting with the same `v fmt`, so this
 * provider defers while it is up and only speaks when it is not. That choice is
 * the whole contract, and returning nothing rather than an empty list is what
 * makes the server get its turn.
 */
describe("server should format", () => {
	it("lets the server answer while it is running", () => {
		assert.strictEqual(serverShouldFormat(true), true)
	})

	it("answers when no server is running", () => {
		assert.strictEqual(serverShouldFormat(false), false)
	})
})

describe("register document formatting", () => {
	it("registers one provider, disposed with the extension", () => {
		resetVscode()
		const subscriptions: { dispose(): void }[] = []
		registerDocumentFormatting({ subscriptions } as unknown as ExtensionContext, () => false)
		assert.strictEqual(subscriptions.length, 1)
		assert.strictEqual(state.formattingProviders.length, 1)
	})

	it("defers to the server with no answer at all", async () => {
		resetVscode()
		const subscriptions: { dispose(): void }[] = []
		registerDocumentFormatting({ subscriptions } as unknown as ExtensionContext, () => true)
		const edits = await state.formattingProviders[0]?.provideDocumentFormattingEdits({
			getText: () => "fn main() {}",
			positionAt: () => ({}),
		})
		// undefined, not []: VS Code takes the first provider that answers with an
		// array, so an empty list here would answer before the server got a turn.
		assert.strictEqual(edits, undefined)
	})
})
