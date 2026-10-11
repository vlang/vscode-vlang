// SYNTAX TEST "source.v" "numbers"
_ := 1_000_000
//   ^^^^^^^^^ constant.numeric.integer.v
_ := 3_122.55
//   ^^^^^^^^ constant.numeric.float.v
_ := 3.14e11
//   ^^^^^^^ constant.numeric.exponential.v
_ := 0xF_F
//   ^^^^^ constant.numeric.hex.v
_ := 0o17_3
//   ^^^^^^ constant.numeric.octal.v
_ := 0b0_11
//   ^^^^^^ constant.numeric.binary.v
_ := 1111111111111111111111111111
//   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ constant.numeric.integer.v
_ := 1111111111111111111111111111.25
//   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ constant.numeric.float.v
_ := 1111111111111111111111111111.25E-10
//   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ constant.numeric.exponential.v
_ := 1_234_567.89e+10
//   ^^^^^^^^^^^^^^^^ constant.numeric.exponential.v
_ := 1_234_.56
//   ^^^^^^^^^ constant.numeric.float.v
_ := 1_234_.56E10
//   ^^^^^^^^^^^^ constant.numeric.exponential.v
_ := 1234567890123456789012345678..30
//   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ constant.numeric.integer.v
_ := 1e10
//   ^^^^ constant.numeric.exponential.v
_ := 2e3
//   ^^^ constant.numeric.exponential.v
_ := 1e-10
//   ^^^^^ constant.numeric.exponential.v
_ := 1E+10
//   ^^^^^ constant.numeric.exponential.v
_ := 1.5e10
//   ^^^^^^ constant.numeric.exponential.v
_ := 1_000e10
//   ^^^^^^^^ constant.numeric.exponential.v
_ := foo2e3()
//   ^^^^^^ - constant.numeric.exponential.v
  e10 := 0
//^^^ variable.other.assignment.v
//^^^ - constant.numeric.exponential.v
  foo2e3 := 0
//^^^^^^ variable.other.assignment.v
//^^^^^^ - constant.numeric.exponential.v
//^^^^^^ - constant.numeric.integer.v
