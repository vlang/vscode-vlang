// SYNTAX TEST "source.v" "string"
_ := 'test'
//    ^^^^ string.quoted.v
a := 1
b := 2
_ := '$a'
//    ^^ string.quoted.v
_ := '\\'
//    ^^ constant.character.escape.v
_ := c'test'
//   ^ storage.type.string.v
_ := `r`
//   ^^^ string.quoted.rune.v
_ := r'\'
//   ^ storage.type.string.v
//    ^^^ string.quoted.raw.v
_ := r"\"
//   ^ storage.type.string.v
//    ^^^ string.quoted.raw.v
_ := r'$a'
//   ^ storage.type.string.v
//    ^^^ string.quoted.raw.v
_ := '${a + b}'
//    ^^ punctuation.definition.template-expression.begin.v
//        ^ keyword.operator.arithmetic.v
//          ^ variable.other.v
//           ^ punctuation.definition.template-expression.end.v

