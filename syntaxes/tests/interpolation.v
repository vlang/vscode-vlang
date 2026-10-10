// SYNTAX TEST "source.v" "string interpolation"
sum := 'total=${add(1, 2)}'
//            ^^ punctuation.definition.template-expression.begin.v
//              ^^^ entity.name.function.v
//                 ^ punctuation.definition.bracket.round.begin.v
//                  ^ constant.numeric.integer.v
//                   ^ punctuation.separator.comma.v
//                     ^ constant.numeric.integer.v
//                      ^ punctuation.definition.bracket.round.end.v
idx := 'item=${arr[0]}'
//             ^^^ variable.other.v
//                ^ punctuation.definition.bracket.square.begin.v
//                 ^ constant.numeric.integer.v
//                  ^ punctuation.definition.bracket.square.end.v
get := 'field=${p.x}'
//              ^ variable.other.v
//               ^ punctuation.delimiter.period.dot.v
//                ^ variable.other.v
