import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as jsonc from "jsonc-parser"

export interface TextMateRule {
    scope: string | string[]
    settings: TextMateRuleSettings
}

export interface TextMateRuleSettings {
    foreground: string | undefined
    background: string | undefined
    fontStyle: string | undefined
}

// Current theme colors
const colors = new Map<string, TextMateRuleSettings>()

export function find(scope: string): TextMateRuleSettings | undefined {
    return colors.get(scope)
}

// Load all textmate scopes in the currently active theme
export async function load() {
    // Remove any previous theme
    colors.clear()
    // Find out current color theme
    const themeName = vscode.workspace.getConfiguration("workbench").get("colorTheme")
    if (typeof themeName != 'string') {
        console.warn('workbench.colorTheme is', themeName)
        return
    }
    // Try to load colors from that theme
    try {
        await loadThemeNamed(themeName)
    } catch (e) {
        console.warn('failed to load theme', themeName, e)
    }
}

// Find current theme on disk
async function loadThemeNamed(themeName: string) {
    for (const extension of vscode.extensions.all) {
        const extensionPath: string = extension.extensionPath
        const extensionPackageJsonPath: string = path.join(extensionPath, "package.json")
        if (!await checkFileExists(extensionPackageJsonPath)) {
            continue
        }
        const packageJsonText: string = await readFileText(extensionPackageJsonPath)
        const packageJson: any = jsonc.parse(packageJsonText)
        if (packageJson.contributes && packageJson.contributes.themes) {
            for (const theme of packageJson.contributes.themes) {
                const id = theme.id || theme.label
                if (id == themeName) {
                    const themeRelativePath: string = theme.path
                    const themeFullPath: string = path.join(extensionPath, themeRelativePath)
                    await loadThemeFile(themeFullPath)
                }
            }
        }
    }
}

async function loadThemeFile(themePath: string) {
    if (await checkFileExists(themePath)) {
        const themeContentText: string = await readFileText(themePath)
        const themeContent: any = jsonc.parse(themeContentText)
        if (themeContent && themeContent.tokenColors) {
            loadColors(themeContent.tokenColors)
            if (themeContent.include) {
                // parse included theme file
                const includedThemePath: string = path.join(path.dirname(themePath), themeContent.include)
                await loadThemeFile(includedThemePath)
            }
        }
    }
}

function loadColors(textMateRules: TextMateRule[]): void {
    for (const rule of textMateRules) {
        if (typeof rule.scope == 'string') {
            if (!colors.has(rule.scope)) {
                colors.set(rule.scope, rule.settings)
            }
        } else if (rule.scope instanceof Array) {
            for (const scope of rule.scope) {
                if (!colors.has(scope)) {
                    colors.set(scope, rule.settings)
                }
            }
        }
    }
}

function checkFileExists(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stats) => {
            if (stats && stats.isFile()) {
                resolve(true)
            } else {
                console.warn('no such file', filePath)
                resolve(false)
            }
        })
    })
}

function readFileText(filePath: string, encoding: string = "utf8"): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(filePath, encoding, (err, data) => {
            if (err) {
                reject(err)
            } else {
                resolve(data)
            }
        })
    })
}