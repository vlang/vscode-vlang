import * as assert from "node:assert/strict"
import { describe, it } from "node:test"
import { InstalledTool, ProvisioningHost, ToolOffer, ToolProvisioner } from "../toolProvisioning"
import { ToolName } from "../toolInstallation"

function hostFixture() {
	const calls: string[] = []
	const tools: Record<ToolName, InstalledTool> = {
		v: { configuration: "v" },
		vls: { configuration: "vls" },
	}
	const offers: ToolOffer[] = []
	let accepted = true
	let state: "current" | "outdated" | "unknown" = "outdated"
	let failInstall = false
	const host: ProvisioningHost = {
		async inspect(tool) {
			calls.push(`inspect:${tool}`)
			return { ...tools[tool] }
		},
		async latest(tool) {
			calls.push(`latest:${tool}`)
			return `${tool}-revision`
		},
		async status(tool, revision, latest) {
			calls.push(`status:${tool}:${revision}:${latest}`)
			return state
		},
		async choose(offer) {
			calls.push(`choose:${offer.tool}:${offer.reason}`)
			offers.push(offer)
			return accepted
		},
		async validateCompiler(executable) {
			calls.push(`validate:${executable}`)
		},
		async install(tool, revision, compiler) {
			calls.push(`install:${tool}:${revision}:${compiler ?? ""}`)
			if (failInstall) throw new Error("build failed")
			return `/managed/${tool}`
		},
		async use(tool, executable) {
			calls.push(`use:${tool}:${executable}`)
			tools[tool].executable = executable
			tools[tool].revision = `${tool}-revision`
		},
	}
	return {
		host,
		calls,
		tools,
		offers,
		accept(value: boolean) {
			accepted = value
		},
		state(value: "current" | "outdated" | "unknown") {
			state = value
		},
		failInstall() {
			failInstall = true
		},
	}
}

describe("tool provisioning decisions", () => {
	it("installs a missing V compiler only after confirmation", async () => {
		const fixture = hostFixture()
		assert.equal(await new ToolProvisioner(fixture.host).check("v", false), "installed")
		assert.deepEqual(fixture.calls, [
			"inspect:v",
			"choose:v:missing",
			"latest:v",
			"install:v:v-revision:",
			"use:v:/managed/v",
		])
		assert.equal(fixture.offers[0]?.reason, "missing")
	})

	it("does not fetch, install, or change configuration when declined", async () => {
		const fixture = hostFixture()
		fixture.accept(false)
		assert.equal(await new ToolProvisioner(fixture.host).check("v", false), "declined")
		assert.deepEqual(fixture.calls, ["inspect:v", "choose:v:missing"])
	})

	it("offers an update when an installed revision is known to be outdated", async () => {
		const fixture = hostFixture()
		fixture.tools.v = { executable: "/old/v", revision: "old", configuration: "custom" }
		assert.equal(await new ToolProvisioner(fixture.host).check("v", true), "installed")
		assert.equal(fixture.offers[0]?.reason, "outdated")
		assert.equal(fixture.offers[0]?.latestRevision, "v-revision")
		assert.ok(
			fixture.calls.indexOf("choose:v:outdated") <
				fixture.calls.indexOf("install:v:v-revision:/old/v"),
		)
		assert.equal(fixture.tools.v.executable, "/managed/v")
	})

	it("leaves a current installation alone", async () => {
		const fixture = hostFixture()
		fixture.tools.v = {
			executable: "/current/v",
			revision: "v-revision",
			configuration: "custom",
		}
		fixture.state("current")
		assert.equal(await new ToolProvisioner(fixture.host).check("v", true), "current")
		assert.deepEqual(fixture.offers, [])
		assert.ok(
			!fixture.calls.some((call) => call.startsWith("install:") || call.startsWith("use:")),
		)
	})

	it("labels unknown revisions as unknown, never outdated", async () => {
		const fixture = hostFixture()
		fixture.tools.v = { executable: "/custom/v", configuration: "custom" }
		fixture.state("unknown")
		fixture.accept(false)
		assert.equal(await new ToolProvisioner(fixture.host).check("v", true), "declined")
		assert.equal(fixture.offers[0]?.reason, "unknown")
		assert.ok(!fixture.calls.some((call) => call.startsWith("install:")))
	})

	it("installs missing V before compiling VLS", async () => {
		const fixture = hostFixture()
		assert.equal(await new ToolProvisioner(fixture.host).check("vls", false), "installed")
		assert.deepEqual(
			fixture.offers.map((offer) => offer.tool),
			["vls", "v"],
		)
		assert.ok(
			fixture.calls.indexOf("use:v:/managed/v") <
				fixture.calls.indexOf("validate:/managed/v"),
		)
		assert.ok(
			fixture.calls.indexOf("validate:/managed/v") <
				fixture.calls.indexOf("install:vls:vls-revision:/managed/v"),
		)
	})

	it("refuses an unsupported configured V before building or selecting VLS", async () => {
		const fixture = hostFixture()
		fixture.tools.v.executable = "/old/v"
		fixture.host.validateCompiler = async (executable) => {
			assert.equal(executable, "/old/v")
			throw new Error("Update V: the current VLS requires V3 compiler answers.")
		}
		await assert.rejects(new ToolProvisioner(fixture.host).check("vls", false), /Update V/)
		assert.ok(
			!fixture.calls.some((call) => call.startsWith("install:") || call.startsWith("use:")),
		)
		assert.equal(fixture.tools.v.executable, "/old/v")
	})

	it("aborts VLS installation when missing V is declined", async () => {
		const fixture = hostFixture()
		const originalChoose = fixture.host.choose
		fixture.host.choose = async (offer) => offer.tool === "vls" && originalChoose(offer)
		await assert.rejects(
			new ToolProvisioner(fixture.host).check("vls", false),
			/VLS needs V to build/,
		)
		assert.ok(!fixture.calls.some((call) => call.startsWith("install:")))
	})

	it("does not switch executable after installation fails", async () => {
		const fixture = hostFixture()
		fixture.failInstall()
		await assert.rejects(new ToolProvisioner(fixture.host).check("v", false), /build failed/)
		assert.ok(!fixture.calls.some((call) => call.startsWith("use:")))
		assert.equal(fixture.tools.v.executable, undefined)
	})
})
