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
