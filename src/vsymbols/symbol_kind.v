module main

type SymbolKind int

const (
	symbol_kind_file           = 0
	symbol_kind_module         = 1
	symbol_kind_namespace      = 2
	symbol_kind_package        = 3
	symbol_kind_class          = 4
	symbol_kind_method         = 5
	symbol_kind_property       = 6
	symbol_kind_field          = 7
	symbol_kind_constructor    = 8
	symbol_kind_enum           = 9
	symbol_kind_interface      = 10
	symbol_kind_function       = 11
	symbol_kind_variable       = 12
	symbol_kind_constant       = 13
	symbol_kind_string         = 14
	symbol_kind_number         = 15
	symbol_kind_boolean        = 16
	symbol_kind_array          = 17
	symbol_kind_object         = 18
	symbol_kind_key            = 19
	symbol_kind_null           = 20
	symbol_kind_enum_member    = 21
	symbol_kind_struct         = 22
	symbol_kind_event          = 23
	symbol_kind_operator       = 24
	symbol_kind_type_parameter = 25
)

fn symbol_kind_str(kind int) string {
	match kind {
		0  { return 'File' }
		1  { return 'Module' }
		2  { return 'Namespace' }
		3  { return 'Package' }
		4  { return 'Class' }
		5  { return 'Method' }
		6  { return 'Property' }
		7  { return 'Field' }
		8  { return 'Constructor' }
		9  { return 'Enum' }
		10 { return 'Interface' }
		11 { return 'Function' }
		12 { return 'Variable' }
		13 { return 'Constant' }
		14 { return 'String' }
		15 { return 'Number' }
		16 { return 'Boolean' }
		17 { return 'Array' }
		18 { return 'Object' }
		19 { return 'Key' }
		20 { return 'Null' }
		21 { return 'EnumMember' }
		22 { return 'Struct' }
		23 { return 'Event' }
		24 { return 'Operator' }
		25 { return 'TypeParameter' }
		else {return 'unknown symbol kind'}
	}
}
