module main

import v.pref
import v.parser
import v.ast
import v.table
import v.token
import v.util
import os
import json
import crypto.md5

const (
	vs_temp_dir = os.join_path(os.temp_dir(), 'vsymbols')
	invalid_input_message = 'Failed to parse json, Please make sure that the input is a JSON string'
)

struct Context {
mut:
	file	File
}

struct File {
mut:
	temp_path		string
	path			string
	modname			string
	symbols			[]SymbolInformation
	current_idx		int = -1
	has_error		bool
}

struct SymbolInformation {
	name		string
	// signature	string
	pos			Position
	real_pos	token.Position
	body_pos	token.Position
	kind		int
	parent_idx	int = -1
	// full_range	Range
}

struct Position {
	line	int
	column	int
}

struct Input {
	filepath	string
	source		string
}

fn main() {
	args := os.args[1..]
	debug := '-debug' in args

	stdin := os.get_lines_joined()
	input := json.decode(Input, stdin) or { 
		eprintln(invalid_input_message)
		return
	}

	// Create temp dir if not exist
	if !os.exists(vs_temp_dir) {
		os.mkdir(vs_temp_dir) or { panic(err) }
	}
	
	filename := create_temp_file(input.filepath, input.source)
	
	fscope := ast.Scope{ parent: 0 }
	prefs := pref.Preferences{
		skip_warnings: true
	}
	table := table.new_table()

	mut ctx := Context{
		file: File{ 
			path: input.filepath 
			temp_path: filename 
		}
	}

	parse_result := parser.parse_file(filename, table, .skip_comments, prefs, fscope)
	ctx.file.modname = parse_result.mod.name
	ctx.file.has_error = parse_result.errors.len > 0
	if ctx.file.has_error {
		println(json.encode(ctx.file))
		return
	}
	ctx.file.process_stmts(parse_result.stmts, -1)

	println(json.encode(ctx.file))
	
	if debug {
		for symbol in ctx.file.symbols {
			println(symbol_kind_str(symbol.kind)) 
			println(symbol)
		}
	}
}

fn (mut file File) process_stmts(stmts []ast.Stmt, parent_idx int) {
	for stmt in stmts {
		match stmt {
			ast.FnDecl {
				fndecl := stmt as ast.FnDecl
				if fndecl.is_method {
					file.process_method(fndecl)
				} else {
					file.process_fn(fndecl)
				}
			}
			ast.StructDecl { 
				file.process_struct(stmt) 
			}
			ast.ConstDecl { 
				file.process_const(stmt) 
			}
			ast.EnumDecl {
				file.process_enum(stmt)
			}
			else { continue }
		}
	}
}

/* --------------------------------- STRUCT --------------------------------- */
fn (mut file File) process_struct(stmt ast.Stmt) {
	structdecl := stmt as ast.StructDecl
	file.symbols << SymbolInformation{
		name: get_real_name(structdecl.name)
		// signature: structdecl.name
		pos: get_real_position(file.temp_path, structdecl.pos)
		real_pos: structdecl.pos
		kind: symbol_kind_struct
		// parent_idx: file.current_idx
	}
if structdecl.fields.len > 0 {
		parent_idx := file.symbols.filter(symbol_isnt_children).len - 1
		for struct_field in structdecl.fields {
			file.symbols << SymbolInformation {
				name: get_real_name(struct_field.name)
				// signature: file.get_signature(struct_field.name)
				pos: get_real_position(file.temp_path, struct_field.pos)
				real_pos: struct_field.pos
				kind: symbol_kind_property
				parent_idx: parent_idx
			}
		}

	}
}

/* --------------------------------- CONST --------------------------------- */
fn (mut file File) process_const(stmt ast.Stmt) {
	constdecl := stmt as ast.ConstDecl
	for const_field in constdecl.fields {
		file.symbols << SymbolInformation{
			name: get_real_name(const_field.name)
			// signature: file.get_signature(const_field.name)
			pos: get_real_position(file.temp_path, const_field.pos)
			real_pos: constdecl.pos
			kind: symbol_kind_constant
			// parent_idx: file.current_idx
		}
	}
}

/* -------------------------------- FUNCTION -------------------------------- */
fn (mut file File) process_fn(fndecl ast.FnDecl) {
	file.symbols << SymbolInformation{
		name: get_real_name(fndecl.name)
		// signature: fndecl.name
		pos: get_real_position(file.temp_path, fndecl.pos)
		real_pos: fndecl.pos
		body_pos: fndecl.body_pos
		kind: symbol_kind_function
		// parent_idx: file.current_idx
	}
	if fndecl.stmts.len > 0 { 
		file.process_stmts(fndecl.stmts, file.symbols.len)
	}
}

/* -------------------------------- METHOD -------------------------------- */
fn (mut file File) process_method(fndecl ast.FnDecl) {
	file.symbols << SymbolInformation{
		name: fndecl.name
		// signature: file.get_signature(fndecl.name)
		pos: get_real_position(file.temp_path, fndecl.pos)
		real_pos: fndecl.pos
		body_pos: fndecl.body_pos
		kind: symbol_kind_method
		// parent_idx: file.current_idx
	}
	if fndecl.stmts.len > 0 {

	}
}

/* ---------------------------------- ENUM ---------------------------------- */
fn (mut file File) process_enum(stmt ast.Stmt) {
	enumdecl := stmt as ast.EnumDecl
	file.symbols << SymbolInformation{
		name: get_real_name(enumdecl.name)
		// signature: file.get_signature(file.modname)
		pos: get_real_position(file.temp_path, enumdecl.pos)
		real_pos: enumdecl.pos
		kind: symbol_kind_enum
		// parent_idx: file.current_idx
	}
	if enumdecl.fields.len > 1 {
		parent_idx := file.symbols.filter(symbol_isnt_children).len - 1
		for enum_field in enumdecl.fields {
			file.symbols << SymbolInformation{
				name: enum_field.name
				// signature: file.get_signature(enumdecl.name)
				pos: get_real_position(file.temp_path, enum_field.pos)
				real_pos: enum_field.pos
				kind: symbol_kind_enum_member
				parent_idx: parent_idx
			}
		}
	}
}

fn (file File) get_signature(name string) string {
	return file.modname + '.' + name
}
/* ---------------------------------- UTILS --------------------------------- */
fn get_real_position(filepath string, pos token.Position) Position {
	source := util.read_file(filepath) or { '' }
	mut p := imax(0, imin(source.len - 1, pos.pos))
	if source.len > 0 {
		for ; p >= 0; p-- {
			if source[p] == `\r` || source[p] == `\n` {
				break
			}
		}
	}
	column := imax(0, pos.pos - p - 1)
	return Position { 
		line: pos.line_nr + 1
		column: imax(1, column) - 1 
	}
}

fn get_real_name(name string) string {
	name_split := name.split('.')
	if name_split.len > 1 { 
		return name_split[name_split.len - 1] 
	}
	return name
}

fn create_temp_file(filename, content string) string {
	if content.len < 3 { return filename }
	hashed_name := md5.sum(filename.bytes()).hex()
	target := os.join_path(vs_temp_dir, hashed_name)
	os.write_file(target, content)
	return target
}

fn symbol_isnt_children(symbol SymbolInformation) bool {
	return symbol.parent_idx == -1
}

[inline]
fn imin(a, b int) int {
	return if a < b { a } else { b }
}

[inline]
fn imax(a, b int) int {
	return if a > b { a } else { b }
}
