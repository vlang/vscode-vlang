// SYNTAX TEST "source.v" "numeric types"
type Signed = int | i8 | i16 | i32 | i64 | isize
//            ^^^ storage.type.numeric.v
//                  ^^ storage.type.numeric.v
//                       ^^^ storage.type.numeric.v
//                             ^^^ storage.type.numeric.v
//                                   ^^^ storage.type.numeric.v
//                                         ^^^^^ storage.type.numeric.v
type Unsigned = u8 | u16 | u32 | u64 | usize | f32 | f64
//              ^^ storage.type.numeric.v
//                   ^^^ storage.type.numeric.v
//                         ^^^ storage.type.numeric.v
//                               ^^^ storage.type.numeric.v
//                                     ^^^^^ storage.type.numeric.v
//                                             ^^^ storage.type.numeric.v
//                                                   ^^^ storage.type.numeric.v
