// SYNTAX TEST "source.v" "raw strings"
name := 'world'
greeting := r'hello ${name}'
//          ^^^^^^^^^^^^^^^^ string.quoted.raw.v
//                  ^^^^^^^ meta.string.interpolation.v
//                  ^^ punctuation.definition.template-expression.begin.v
plain := 'no ${name} here' but this is not raw
//           ^^^^^^^^^^^^^ string.quoted.v
