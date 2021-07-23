// SYNTAX TEST "source.v" "string"
_ := 'test'
//    ^^^^ string.quoted.v
a := 1
_ := '$a'
//    ^^ variable.other.interpolated.v
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
//     ^^ variable.other.interpolated.v

