/** Generating V decoder structs from a document.
 *
 * Everything here is pure so it is tested without an editor. The editor
 * wiring (commands on document files) lives in `commands.ts`.
 *
 * REVIEW NOTE — re-verify against vlib on every V minor bump (last
 * verified V 0.5.2): this module hardcodes four moving targets, the V
 * struct syntax, the decoder calls and their `@[json: ...]`-style field
 * attributes. The `json` → `json2` migration already broke this shape
 * once (the old cJSON module is gone). When V renames a decoder or
 * changes attribute spelling, the generated code silently stops
 * compiling: regenerate the fixtures against the new compiler and
 * update the templates. JSON parses with the builtin reader; TOML and
 * YAML share this core but are not wired end to end yet, because parsing
 * them needs declared parser dependencies, which need the package lock
 * repaired first. XML and CSV parse with the strict readers in
 * `docTables.ts`.
 */

import { mergeRepeatShapes, parseCsvDocument, parseXmlDocument, typedCsvRecords } from "./docTables"

export type DocumentFormat = "json" | "toml" | "yaml" | "xml" | "csv"

export interface DocumentFormatSpec {
	/** Fallback type for null, empty and mixed values, e.g. `json2.Any`. */
	anyType: string
	/** Rename attribute for a foreign key, e.g. ` @[json: 'a-b']`. */
	renameAttribute: (sourceKey: string) => string
	/** Imports for a schema, e.g. `["encoding.xml", "json2"]`. */
	importsFor: (schema: DecodedSchema) => string[]
	/** Example function lines for a schema. */
	exampleFor: (schema: DecodedSchema) => string[]
}

/** Escape a key for a single-quoted V attribute. */
function escapeAttributeKey(sourceKey: string): string {
	return sourceKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

/** A rename attribute in one format's spelling. */
function renameAttribute(kind: "json" | "toml"): (sourceKey: string) => string {
	return (sourceKey) => ` @[${kind}: '${escapeAttributeKey(sourceKey)}']`
}

/** Whether any rendered type mentions the fallback type. */
function schemaUsesType(schema: DecodedSchema, typeName: string): boolean {
	if (schema.rootType.includes(typeName)) {
		return true
	}
	return schema.structs.some((struct) =>
		struct.fields.some((field) => field.type.includes(typeName)),
	)
}

function decodeExample(
	decodeFunction: string,
	rootType: string,
	call: string,
	returnsResult: boolean,
): string[] {
	const returns = returnsResult ? `!${rootType}` : rootType
	return [`fn ${decodeFunction}(data string) ${returns} {`, `\treturn ${call}`, "}"]
}

export const documentFormats: Record<DocumentFormat, DocumentFormatSpec> = {
	json: {
		anyType: "json2.Any",
		renameAttribute: renameAttribute("json"),
		importsFor: () => ["json2"],
		exampleFor: (schema) =>
			decodeExample(
				schema.decodeFunction,
				schema.rootType,
				`json2.decode[${schema.rootType}](data, json2.DecoderOptions{})`,
				true,
			),
	},
	toml: {
		anyType: "toml.Any",
		renameAttribute: renameAttribute("toml"),
		importsFor: () => ["toml"],
		exampleFor: (schema) =>
			decodeExample(
				schema.decodeFunction,
				schema.rootType,
				`toml.decode[${schema.rootType}](data)`,
				true,
			),
	},
	yaml: {
		anyType: "yaml.Any",
		renameAttribute: renameAttribute("json"),
		importsFor: () => ["yaml"],
		exampleFor: (schema) =>
			decodeExample(
				schema.decodeFunction,
				schema.rootType,
				`yaml.decode[${schema.rootType}](data)`,
				true,
			),
	},
	csv: {
		anyType: "string",
		renameAttribute: () => "",
		importsFor: () => ["encoding.csv"],
		exampleFor: (schema) => {
			const item = schema.structs[0]?.name ?? schema.rootType
			return decodeExample(
				schema.decodeFunction,
				`[]${item}`,
				`csv.decode[${item}](data)`,
				false,
			)
		},
	},
	xml: {
		anyType: "json2.Any",
		renameAttribute: () => "",
		importsFor: (schema) =>
			schemaUsesType(schema, "json2.Any") ? ["encoding.xml", "json2"] : ["encoding.xml"],
		exampleFor: (schema) => [
			"// No struct decoder exists: load the document, then read fields",
			"// with get_elements_by_tag and friends.",
			`fn ${schema.decodeFunction.replace(/^decode_/, "load_")}(data string) !xml.XMLDocument {`,
			"\treturn xml.XMLDocument.from_string(data)",
			"}",
		],
	},
}

export interface StructFieldDef {
	name: string
	type: string
	sourceKey?: string
}

export interface StructDef {
	name: string
	fields: StructFieldDef[]
}

export interface DecodedSchema {
	structs: StructDef[]
	rootType: string
	decodeFunction: string
}

const validIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/

const vKeywords = new Set([
	"as",
	"assert",
	"break",
	"chan",
	"const",
	"continue",
	"defer",
	"else",
	"enum",
	"false",
	"fn",
	"for",
	"go",
	"goto",
	"if",
	"import",
	"in",
	"interface",
	"is",
	"lock",
	"match",
	"module",
	"mut",
	"none",
	"or",
	"pub",
	"return",
	"rlock",
	"select",
	"shared",
	"static",
	"struct",
	"true",
	"type",
	"unsafe",
])

function capitalize(name: string): string {
	return name.slice(0, 1).toUpperCase() + name.slice(1)
}

/** A valid V identifier for a key, with rename info when it differs. */
function fieldName(key: string): { name: string; sourceKey?: string } {
	if (validIdentifier.test(key) && !vKeywords.has(key)) {
		return { name: key }
	}
	let name = key.replace(/[^A-Za-z0-9_]/g, "_")
	if (/^[0-9]/.test(name)) {
		name = `_${name}`
	}
	if (name === "" || vKeywords.has(name)) {
		name = name === "" ? "field" : `${name}_`
	}
	return { name, sourceKey: key }
}

function scalarType(value: string | number | boolean): string {
	if (typeof value === "string") {
		return "string"
	}
	if (typeof value === "boolean") {
		return "bool"
	}
	if (Number.isInteger(value)) {
		return Math.abs(value) <= 2147483647 ? "int" : "i64"
	}
	return "f64"
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sameKeys(first: Record<string, unknown>, other: unknown): boolean {
	if (!isObject(other)) {
		return false
	}
	const left = Object.keys(first)
	const right = Object.keys(other)
	return left.length === right.length && left.every((key) => right.includes(key))
}

/** Build struct definitions for a parsed document value. */
export function structsFromValue(rootName: string, value: unknown, anyType: string): DecodedSchema {
	const structs: StructDef[] = []
	const usedNames = new Set<string>()
	const uniqueName = (base: string): string => {
		let name = capitalize(base === "" ? "value" : base)
		let counter = 2
		while (usedNames.has(name)) {
			name = `${capitalize(base)}${counter}`
			counter++
		}
		usedNames.add(name)
		return name
	}
	const valueType = (hint: string, item: unknown): string => {
		if (item === null || item === undefined) {
			return anyType
		}
		if (typeof item === "string" || typeof item === "boolean" || typeof item === "number") {
			return scalarType(item)
		}
		if (Array.isArray(item)) {
			if (item.length === 0) {
				return `[]${anyType}`
			}
			const first = item[0]
			if (
				isObject(first) &&
				Object.keys(first).length > 0 &&
				item.every((element) => sameKeys(first, element))
			) {
				return `[]${valueType(hint, first)}`
			}
			if (!item.some((element) => typeof element === "object")) {
				const elementTypes = new Set<string>()
				for (const element of item as (string | number | boolean)[]) {
					elementTypes.add(scalarType(element))
				}
				const onlyType = [...elementTypes][0]
				if (elementTypes.size === 1 && onlyType !== undefined) {
					return `[]${onlyType}`
				}
				if (item.every((element) => typeof element === "number")) {
					return "[]f64"
				}
			}
			return `[]${anyType}`
		}
		if (isObject(item)) {
			const entries = Object.entries(item)
			if (entries.length === 0) {
				return anyType
			}
			const name = uniqueName(hint)
			const struct: StructDef = { name, fields: [] }
			structs.push(struct)
			struct.fields = entries.map(([key, fieldValue]) => {
				const field = fieldName(key)
				return {
					name: field.name,
					type: valueType(key, fieldValue),
					...(field.sourceKey ? { sourceKey: field.sourceKey } : {}),
				}
			})
			return name
		}
		return anyType
	}
	if (!isObject(value) && !Array.isArray(value)) {
		throw new Error("The top level must be an object or an array to infer structs from.")
	}
	const rootType = valueType(rootName, value)
	const decodeName = `decode_${rootType.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}`
	return { structs, rootType, decodeFunction: decodeName }
}

/** Render the module: imports, structs, and a decode example. */
export function renderModule(spec: DocumentFormatSpec, schema: DecodedSchema): string {
	const lines = [...spec.importsFor(schema).map((module) => `import ${module}`), ""]
	for (const struct of schema.structs) {
		lines.push(`struct ${struct.name} {`)
		for (const field of struct.fields) {
			const attribute = field.sourceKey ? spec.renameAttribute(field.sourceKey) : ""
			lines.push(`\t${field.name} ${field.type}${attribute}`)
		}
		lines.push("}", "")
	}
	lines.push(...spec.exampleFor(schema))
	return `${lines.join("\n")}\n`
}

/** Root struct name from a file name: `foo.json` decodes into `Foo`. */
export function rootNameForFile(fileName: string): string {
	const base = fileName.split(/[\\/]/).pop() ?? fileName
	const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base
	const cleaned = stem.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[0-9]+/, "")
	return capitalize(cleaned === "" ? "root" : cleaned)
}

/** Schema for a JSON document. */
export function schemaFromJson(rootName: string, text: string): DecodedSchema {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		throw new Error("The file is not valid JSON.")
	}
	return structsFromValue(rootName, value, documentFormats.json.anyType)
}

/** Schema for an XML document, merging repeat siblings first. */
export function schemaFromXml(rootName: string, text: string): DecodedSchema {
	return structsFromValue(
		rootName,
		mergeRepeatShapes(parseXmlDocument(text)),
		documentFormats.xml.anyType,
	)
}

/** Schema for a CSV document, typing each column across all rows. */
export function schemaFromCsv(rootName: string, text: string): DecodedSchema {
	const rows = parseCsvDocument(text)
	if (rows.length === 0) {
		throw new Error("The file has no data rows to infer structs from.")
	}
	return structsFromValue(rootName, typedCsvRecords(rows), documentFormats.csv.anyType)
}
