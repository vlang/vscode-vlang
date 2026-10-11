import type { ExtensionContext } from "vscode"
import * as assert from "assert"
import { describe, it } from "node:test"
import {
	enclosingTestLine,
	registerTestGutter,
	testFunctionLines,
	testFunctionNameAtLine,
	testGutterCommand,
} from "../testGutter"
import { resetParseCache } from "../documentMemo"
import { resetVscode, state, Uri } from "./fixtures/vscode"

const source = [
	"module lists",
	"",
	"// add sums its arguments.",
	"fn test_add() {",
	"\tassert add(1, 2) == 3",
	"}",
	"",
	"// subtract takes the second from the first.",
	"fn test_subtract() {",
	"\tassert true",
	"}",
	"",
].join("\n")

describe("test function lines", () => {
	it("finds each top-level test", () => {
		assert.deepStrictEqual(testFunctionLines(source), [3, 8])
	})

	it("reads the name `v test -run-only` takes", () => {
		assert.strictEqual(testFunctionNameAtLine(source, 3), "test_add")
		assert.strictEqual(testFunctionNameAtLine(source, 8), "test_subtract")
		assert.strictEqual(testFunctionNameAtLine(source, 4), undefined)
	})

	it("ignores an indented test, which is not runnable", () => {
		const indented = ["struct Holder {", "\tfn test_method() {}", "}", ""].join("\n")
		assert.deepStrictEqual(testFunctionLines(indented), [])
	})

	it("ignores a test that is commented out", () => {
		const commented = ["// fn test_commented() {}", "fn main() {}", ""].join("\n")
		assert.deepStrictEqual(testFunctionLines(commented), [])
	})

	it("finds nothing in a document with no test", () => {
		assert.deepStrictEqual(testFunctionLines("module main\n\nfn main() {}\n"), [])
	})
})

describe("enclosing test line", () => {
	it("is the test a cursor inside it belongs to", () => {
		assert.strictEqual(enclosingTestLine(source, 4), 3)
		assert.strictEqual(enclosingTestLine(source, 3), 3)
		assert.strictEqual(enclosingTestLine(source, 9), 8)
	})

	it("keeps a heading comment with its own test", () => {
		// The comment at 7 documents `fn test_subtract` below it, so a cursor there
		// must run that test rather than the one above it.
		assert.strictEqual(enclosingTestLine(source, 7), 8)
	})

	it("keeps the test above a cursor in its body", () => {
		// A cursor on the assertion inside test_add has code between it and the next
		// test, which is what distinguishes a heading from a body.
		assert.strictEqual(enclosingTestLine(source, 4), 3)
	})

	it("is -1 when the cursor is above every test", () => {
		assert.strictEqual(enclosingTestLine(source, 0), -1)
	})
})

describe("register test gutter", () => {
	function provide(text: string): unknown[] | undefined {
		resetVscode()
		resetParseCache()
		const subscriptions: { dispose(): void }[] = []
		// The manager is never called by these assertions: they are about the lens
		// the provider offers, not about the task it would start.
		registerTestGutter({ subscriptions } as unknown as ExtensionContext, {} as never)
		assert.strictEqual(subscriptions.length, 2)
		const provider = state.codeLenses[0]
		assert.notStrictEqual(provider, undefined)
		return provider?.provideCodeLenses({
			uri: Uri.file("lists_test.v"),
			version: 1,
			getText: () => text,
		}) as unknown[] | undefined
	}

	it("offers a lens that runs one named test", () => {
		const lenses = provide(source) as { command: { command: string; arguments: unknown[] } }[]
		assert.strictEqual(lenses.length, 2)
		// The name is carried so the task path adds `-run-only`, which is what makes
		// the lens run one test rather than the whole file.
		assert.strictEqual(lenses[0]?.command.command, testGutterCommand)
		assert.deepStrictEqual(lenses[0]?.command.arguments[1], "test_add")
		assert.deepStrictEqual(lenses[1]?.command.arguments[1], "test_subtract")
	})

	it("answers nothing for a document with no test, leaving the server's lenses", () => {
		assert.strictEqual(provide("module main\n\nfn main() {}\n"), undefined)
	})

	it("registers the command the lens runs, so clicking it is not a no-op", () => {
		resetVscode()
		resetParseCache()
		const subscriptions: { dispose(): void }[] = []
		registerTestGutter({ subscriptions } as unknown as ExtensionContext, {} as never)
		// A CodeLens command runs on the client and never reaches the language
		// server's middleware, so the handler has to be registered here or the lens
		// does nothing when it is clicked.
		assert.strictEqual(subscriptions.length, 2)
		assert.ok(state.commands.has(testGutterCommand))
	})
})
