# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.9] - 2019-12-30

### Added

- Highlighting for `as` keyword [e7c72b2](https://github.com/0x9ef/vscode-vlang/commit/e7c72b2cb23444d5c1fa5e5aa2f61e64eaa8264f)
- Highlighting for `charptr` keyword [b9f16bc](https://github.com/0x9ef/vscode-vlang/commit/b9f16bce1e8089d0b2b2dd50bf09ff8aec621122)
- Support for `.vsh` [e79a22e](https://github.com/0x9ef/vscode-vlang/commit/e79a22e72dabeca2cc26e08829e6da6f1a957e3c)
- Some more snippets [b06ae81](https://github.com/0x9ef/vscode-vlang/commit/b06ae81b47ec6354ef1ed887ce6357ef03cd712c)

### Changed

- Fixed invalid icon theme [be3fcb3](https://github.com/0x9ef/vscode-vlang/commit/be3fcb399a309d52e8869f6ac9067aa454dd3b8a)
- Fixed `vfmt` [3522196](https://github.com/0x9ef/vscode-vlang/commit/3522196890c4f89da2f173684fe326e79fbb4c52)
- Cleaned up resource usage [4f587ed](https://github.com/0x9ef/vscode-vlang/commit/4f587ed1cbcd6e884da250528ba7f2e0728127cb)
- Removed unused entries from `.travis.yml` [96e1a0b](https://github.com/0x9ef/vscode-vlang/commit/96e1a0b06946d2659d5e92242aeabbfc56faf909)

## [0.0.8] - 2019-10-20

### Added

- Highlighting for attributes. [f85aec5](https://github.com/0x9ef/vscode-vlang/commit/f85aec57a46116204c9f3fbe370277907ff00a9c)
- Highlighting for `${...}` syntax [f11581d](https://github.com/0x9ef/vscode-vlang/commit/f11581dcaaadb88da2130a4d9b444d4281f1c0d4)
- Highlighting for `none` keyword. [d682dbe](https://github.com/0x9ef/vscode-vlang/commit/d682dbefb6330b9383d849334da7677d6f6cf2d6)

### Changed

- Fixed nested comments. [f19d486](https://github.com/0x9ef/vscode-vlang/commit/f19d4868dd34a729bee01441eb62c6a59a16a1e6)
- Insert tabs instead of spaces. [f4525ca](https://github.com/0x9ef/vscode-vlang/commit/f4525ca1eb3d514eeb2bb2956724dc18a2645235)
- Corrupted icon. [beeb022](https://github.com/0x9ef/vscode-vlang/commit/beeb0223c03a1a40b976ef350d546282b3cfa8ff)
- Infinity recursion in certain grammar patterns [a40e951](https://github.com/0x9ef/vscode-vlang/commit/1638585f838e30c2587eaf9ee8a08c28785b6f42)

## [0.0.7] - 2019-08-12

### Added

- New demos [636c358](https://github.com/0x9ef/vscode-vlang/commit/636c358eb53104f0b3f42f214305f9ef10fb9599)
- New badges [ab94ea7](https://github.com/0x9ef/vscode-vlang/commit/ab94ea75950a59a5832cb6a6f32e6e8d5197e63a)

### Changed

- Fixed function declaration from new line [cede5204](https://github.com/0x9ef/vscode-vlang/commit/cede52044e7acd56f880b0729dc3280c16d4c3e9)
- Fixed invalid function space pattern [88477c2](https://github.com/0x9ef/vscode-vlang/commit/88477c24709836dd8e7d5fdd01d0f729870c278b)
- Fixed import, module (s) bag [ef56b2c](https://github.com/0x9ef/vscode-vlang/commit/ef56b2c8020d7b6d4d5408635339fa29265ad216)

### Removed

- Old demos [636c358](https://github.com/0x9ef/vscode-vlang/commit/636c358eb53104f0b3f42f214305f9ef10fb9599)
- testv.tmLanguage.json [4e3a353](https://github.com/0x9ef/vscode-vlang/commit/4e3a35358d7927efbd47b25911b50e9ad3ee1cd2)
- Themes for prefering used defined themes [ef56b2c](https://github.com/0x9ef/vscode-vlang/commit/ef56b2c8020d7b6d4d5408635339fa29265ad216)

## [0.0.6] - 2019-07-15

### Added

- Metadata properties [37dd64b](https://github.com/0x9ef/vscode-vlang/commit/37dd64bcaf1a7799260d29773f55bf23f5f28247)
- Ignore for specify files [45fbdd9](https://github.com/0x9ef/vscode-vlang/commit/45fbdd952a7c8dc6e971f52388b9629c9fd6ba4e)
- Pattern for reference [b495745](https://github.com/0x9ef/vscode-vlang/commit/b495745e4354aee7d609adef164fc48be3a75d7e)

### Fixed

- Invalid pattern for `ustring` [f7f32d1](https://github.com/0x9ef/vscode-vlang/commit/f7f32d108f2aa031b8335073ef77ab774a77f284)
- Travis support [d1931ed](https://github.com/0x9ef/vscode-vlang/commit/d1931ed55b42161f6bd1df023685c1d060471165)
- Invalid pattern for `variable-assignment` [c2ad846](https://github.com/0x9ef/vscode-vlang/commit/c2ad846e79aed3e5c4add8ee2e48aa3d20f18607)
- `#include` pattern [ecf50c0](https://github.com/0x9ef/vscode-vlang/commit/ecf50c0a830923090b6f13700e8baca9bc3c3c86)

### Changed

- types/vscode version to 1.20.0 [37dd64b](https://github.com/0x9ef/vscode-vlang/commit/37dd64bcaf1a7799260d29773f55bf23f5f28247)

### Removed

- Autoclosed multilines comments (block) [012e640](https://github.com/0x9ef/vscode-vlang/commit/012e640a84772162a7d822c3b87890c20244fa78)

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
