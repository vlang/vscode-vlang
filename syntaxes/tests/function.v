// SYNTAX TEST "source.v"
   pub fn foo<T>()
// ^^^ storage.modifier.v
//     ^^ keyword.fn.v
//        ^^^ entity.name.function.v
//            ^ entity.name.generic.v
   fn foo()
// ^^ keyword.fn.v
//    ^^^ entity.name.function.v
   pub fn foo()
// ^^^ storage.modifier.v
//     ^^ keyword.fn.v
//        ^^^ entity.name.function.v
   pub fn (test Blah) foo()
// ^^^ storage.modifier.v
//     ^^ keyword.fn.v
//                    ^^^ entity.name.function.v
   fn C.foo()
// ^^ keyword.fn.v
//      ^^^ entity.name.function.v
fn f(mut x int)
//   ^^^ storage.modifier.v
//         ^^^ storage.type.numeric.v
fn do<X, Y>()
//   ^ punctuation.definition.bracket.angle.begin.v
//    ^ entity.name.generic.v
//       ^ entity.name.generic.v
//        ^ punctuation.definition.bracket.angle.end.v
fn f() MyStruct
//     ^^^^^^^^ entity.name.type.v
