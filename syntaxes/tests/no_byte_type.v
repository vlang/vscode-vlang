// SYNTAX TEST "source.v" "byte is no type"
type Raw = []byte
//           ^^^^ - storage.type.byte.v
const one = byte(1)
//          ^^^^ - storage.type.byte.v
type Octets = []u8
//              ^^ storage.type.numeric.v
