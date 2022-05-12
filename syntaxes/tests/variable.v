// SYNTAX TEST "source.v"
    abc := ''
//  ^^^ variable.other.assignment.v
mut abc := ''
//  ^^^ variable.other.assignment.v
    abc = ''
//  ^^^ variable.other.assignment.v
   abc, foo := '', ''
// ^^^ variable.other.assignment.v
//    ^^ - variable.other.assignment.v
//      ^^^ variable.other.assignment.v
   variable2 := 2
// ^^^^^^^^^ variable.other.assignment.v
//         ^ - constant.numeric.integer.v
