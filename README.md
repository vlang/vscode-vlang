# V language support for Visual Studio Code

[![Version](https://vsmarketplacebadge.apphb.com/version/vlanguage.vscode-vlang.svg)](https://marketplace.visualstudio.com/items?itemName=vlanguage.vscode-vlang)
[![Installs](https://vsmarketplacebadge.apphb.com/installs/vlanguage.vscode-vlang.svg)](https://marketplace.visualstudio.com/items?itemName=vlanguage.vscode-vlang)
![GitHub Workflow Status](https://img.shields.io/github/workflow/status/vlang/vscode-vlang/CI)

Provides [V language](https://vlang.io) support for Visual Studio Code.

## Table of Contents

-   [Preview](#preview)
-   [Features](#features)
    -   [Code Editing](#code-editing)
    <!-- -   [Testing](#testing) -->
    -   [Others](#others)

## Preview

![First demo screenshot](./images/demo.png)

## Features

### Code Editing

-   Automatically format code (powered by `v fmt`)
-   Syntax highlighting
-   Code Snippets
-   V Language Server support (alpha). Enable by setting `"v.vls.enable"` to `true`

### Others

-   Upload to the DevBits V Playground.

## Usage

You will need to install [Visual Studio Code](https://code.visualstudio.com/) >= `1.51`. In the command palette (Cmd+Shift+P) select Install Extension and choose `V`. You can also install the extension from the [Marketplace](https://marketplace.visualstudio.com/vscode). Open any `.v, .vh, .vsh` file in VS Code.

## Commands

-   `V: Run current file`
-   `V: Build an optimized executable from current file`
-   `V: Show help info`
-   `V: Show V version`
-   `V: Upload and share current code to V playground`

You can access all of the above commands from the command palette (Cmd+Shift+P or Ctrl+Shift+P).

### Configuration

#### V

```json
{
	// Optional:
	// "v.pathToExecutableFile": "/path/to/v/folder/v"
	// "v.format.args": "",
}
```

#### Language Server (alpha)

The [V Language Server](https://github.com/vlang/vls) is currently disabled by default.

To enable the [V Language Server](https://github.com/vlang/vls), set this in your `settings.json`:

```json
{
	"v.vls.enable": true
	// Optional:
	// "v.vls.customPath": "/path/to/vls/dir/cmd/vls/vls",
	// "v.vls.enableFeatures": ""
	// "v.vls.disableFeatures": ""
}
```

To minimize memory usage, consider compiling the V Language Server from source by running this command inside your `vls` directory (clone it):

```bash
# This assumes you already ran the following commands:
# git clone https://github.com/vlang/vls
# cd vls
v -prod cmd/vls -gc boehm -manualfree -cc clang  -m64 -compress -g
```

After that, be sure to set the `v.vls.customPath`:

```json
{
	"v.vls.customPath": "/path/to/vls/dir/cmd/vls/vls"
}
```

## Changelog

**0.1.9**

-   Improve `v fmt` support. This extension now registers as the default formatter for V in VSCode.
-   V Language Server now starts up lazily rather than eagerly. Before, it started up in any workspace which contained `.v` files. Now it only starts up if one of the tabs is a V tab and a file persisted to disk
-   Fixed a bug where sometimes `v fmt` would run before saving to disk. This changes it to copy the document to stdin instead, so there's no chance of that happening.
-   `v fmt` now logs syntax errors in the output and shows a checkmark. If the V Language Server is not running and formatting failed due to a syntax error, the output window will appear with the error message (easier to read than a popup)
-   Multiple workspace folders in the same window should be a little more reliable
-   Remove features that just didn't work
-   Non-userfacing: switched from webpack to esbuild to make this extension build faster

## License

[MIT](./LICENSE)
