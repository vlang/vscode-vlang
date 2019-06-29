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
- Invalid pattern for label (conflict with default keyword) __`default:`__
### Changed
- Included pattern for variable increment, decrement.  

## [0.0.5] - 2019-06-05
### Added 
- Pattern for static type `intptr`
- Pattern for control keyword `$else`
- Pattern for builtin casting/control function ([f877c3b](https://github.com/0x9ef/vscode-vlang/commit/f877c3b844564125431f9bd4accda0b4924f5f6c)).
- String placeholder, escaped characters.
- Auto closed multiline comments ([b173e1e](https://github.com/0x9ef/vscode-vlang/pull/8))
- Launch script for debuggin ([24b183a](https://github.com/0x9ef/vscode-vlang/commit/24b183aa79964962a1e6083ac5847a207935629b))
- Added two commands `v.ver, v.prod` ([d1d99a9](https://github.com/0x9ef/vscode-vlang/commit/d1d99a9806f9ffbbe235974f153fa837f2eb6b3b))
- Added TypeScript based project ([9fa4992](https://github.com/0x9ef/vscode-vlang/commit/9fa4992a7f549351c97d17b1ff95c94970e74bb3))
- Created `package-lock.json` ([16114d6](https://github.com/0x9ef/vscode-vlang/commit/16114d69ece533c217a0153655a2796c717fd02c))
### Fixed
- Invalid pattern for new-exist-extend-limited-overloaded functions ([8952a71](https://github.com/0x9ef/vscode-vlang/commit/8952a717ecd2683cfc69caca52f232a5540cd2b5))
- Invalid pattern for `module, import, #include`
- Invalid pattern for `enum, type, struct, interface` ([83e27e0](https://github.com/0x9ef/vscode-vlang/commit/83e27e0e64a4a51414ec8ed80dbc6f03fb8bb517))
- Invalid typo `ligth` to `light` ([09b5257](https://github.com/0x9ef/vscode-vlang/commit/09b5257c7e0d4e10735d3c23d9cfa2eb27735dab))
- Invalid pattern for variable assignment.