# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2019-06-10
### Added
- Code snippets for standart keywords and expressions.
- Developer dark theme for **V**.
- TextMate Language Support for **V**.
- Icons in `/icons` folder.
- Images in `/images` folder.
- Icon theme in `/theme/icon-theme.json`.
- Icon for `.v` based files in `theme/images/v.svg`.
### Changed
### Removed

## [0.0.2] - 2019-06-12
### Added
- Pattern for new-function variables, punctuation characters.
- Pattern for exist-function punctuation characters.
- Pattern for arithmethic, relation, logical, bitwise, assignment operators.
### Fixed
- Invalid patterns for assignment operator. 
- Invalid patterns for integer, float, hex numerics. 
- Invalid patterns for new/exist function arguments.
### Changed
- Highligting for `module, import, struct, enum, interface` from `default` to `bold underline`.
### Removed

## [0.0.3] - 2019-06-16
### Added
- Pattern for generics.
- Generic highlighting.
- Assignment operators `&=, |=, ^=, &&=, ||=, >>=, <<=`.
### Fixed
- Invalid pattern for float numeric. 
- Invalid pattern for new/exist function. 
### Changed
### Removed

## [0.0.4] - 2019-06-22
### Added
- Pattern for static types `byteptr, voidptr, ustring`
- Pattern for extend (extra) function syntax `fn (a mut Vector) Set() {}`
- Pattern for limited operator overloading `fn (a Operand) + (b Operand)Operand {}`
- String placeholder.
- String escaped characters.
- Highlighting for V compiler headers without open source code __`.vh`__
### Fixed
- Invalid pattern for floating point numbers.
- Invalid pattern for single, double strings. 
- Invalid pattern for new function declaration.
- Invalid pattern for exist function.
- Invalid patterns for `module, import, #include, #flag`
- Invalid pattern for generic `<T>`
- Invalid pattern for variable assignment.
- Invalid pattern for label (conflict with default keyword) __`default:`__.
### Changed
- Included pattern for variable increment, decrement.  