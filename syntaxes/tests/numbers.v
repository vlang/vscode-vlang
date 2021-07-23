// SYNTAX TEST "source.v" "numbers"
_ := 1_000_000
//   ^^^^^^^^^ constant.numeric.integer.v
_ := 3_122.55
//   ^^^^^^^^ constant.numeric.float.v
_ := 0xF_F
//   ^^^^^ constant.numeric.hex.v
_ := 0o17_3
//   ^^^^^^ constant.numeric.octal.v
_ := 0b0_11
//   ^^^^^^ constant.numeric.binary.v
