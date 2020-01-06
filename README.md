# V language support for Visual Studio Code

[![Version](https://vsmarketplacebadge.apphb.com/version/0x9ef.vscode-vlang.svg)](https://marketplace.visualstudio.com/items?itemName=0x9ef.vscode-vlang)
[![Installs](https://vsmarketplacebadge.apphb.com/installs/0x9ef.vscode-vlang.svg)](https://marketplace.visualstudio.com/items?itemName=0x9ef.vscode-vlang)
[![Build Status](https://travis-ci.org/0x9ef/vscode-vlang.svg?branch=master)](https://travis-ci.org/0x9ef/vscode-vlang)

Provides [V language](https://vlang.io) support for Visual Studio Code.

- [Preview](#previe)
- [Features](#features)
  - [Code Editing](#code-editing)
  - [Testing](#testing)
  - [Others](#others)

## Preview

![First demo screenshot](./images/demo1.PNG)
![Second demo screenshot](./images/demo2.PNG)

## Features

### Code Editing

- Code Snippets for quick coding.
- Format code on file save as well as format manually (using `v fmt`). To disable the format on save feature, add `"[v]": {"editor.formatOnSave": false}` to your settings.
- Run V file (using `v run`).

### Testing

- Run Tests under the cursor, in current file, in current package, in the whole workspace using either commands or codelens. [WIP]

### Others

- Upload to the V Playground. [WIP]
- Upload to the DevBits V Playground.

## Usage

You will need to install Visual Studio Code >= `0.26`. In the command palette (cmd-shift-p) select Install Extension and choose `V`.

_Note_: It is recommended to turn `Auto Save` on in Visual Studio Code (`File -> Auto Save`) when using this extension.

## License

[MIT](./LICENSE)
