module main

import v.ast

fn (mut file File) process_expr(expr ast.Expr, parent_idx int) {
	match expr {
		ast.AssignExpr {
			// println('AssignExpr')
		}
		ast.ArrayInit {
			// println('ArrayInit')
		}
		ast.AsCast {
			// println('AsCast')
		}
		ast.Assoc {
			// println('Assoc')
		}
		ast.BoolLiteral {
			// println('BoolLiteral')
		}
		ast.CallExpr {
			// file.process_call_expr(expr as ast.CallExpr)
			// println('CallExpr')
		}
		ast.CastExpr {
			// println('CastExpr')
		}
		ast.CharLiteral {
			// println('CharLiteral')
		}
		ast.ConcatExpr {
			// println('ConcatExpr')
		}
		ast.EnumVal {
			// println('EnumVal')
		}
		ast.FloatLiteral {
			// println('FloatLiteral')
		}
		ast.Ident {
			// println('Ident')
		}
		ast.IfExpr {
			// println('IfExpr')
		}
		ast.IndexExpr {
			// println('IndexExpr')
		}
		ast.InfixExpr {
			// println('InfixExpr')
		}
		ast.IntegerLiteral {
			// println('IntegerLiteral')
		}
		ast.MapInit {
			// println('MapInit')
		}
		ast.MatchExpr {
			// println('MatchExpr')
		}
		ast.None {
			// println('None')
		}
		ast.OrExpr {
			// println('OrExpr')
		}
		ast.ParExpr {
			// println('ParExpr')
		}
		ast.PostfixExpr {
			// println('PostfixExpr')
		}
		ast.PrefixExpr {
			// println('PrefixExpr')
		}
		ast.RangeExpr {
			// println('RangeExpr')
		}
		ast.SelectorExpr {
			// println('SelectorExpr')
		}
		ast.StringInterLiteral {
			// println('StringInterLiteral')
		}
		ast.StringLiteral {
			// println('StringLiteral')
		}
		ast.StructInit {
			// println('StructInit')
		}
		ast.Type {
			// println('Type')
		}
		ast.TypeOf {
			// println('TypeOf')
		}
		else { return }
	}
}

// fn (mut file File) process_call_expr(callexpr ast.CallExpr) {
	
// }
