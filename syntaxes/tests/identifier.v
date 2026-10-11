// SYNTAX TEST "source.v" "identifiers keep their digits"
x := a1
//   ^^ variable.other.v
y := b2c3
//   ^^^^ variable.other.v
println(b2c3)
//      ^^^^ variable.other.v
    n1 += 1
//  ^^ variable.other.v
fn f(v1 int) int {
	return v1 + 1
}
