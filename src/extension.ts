'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "idea-shortcut-key" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerTextEditorCommand('idea-shortcut-key.fqn', copyFQN);

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}


async function copyFQN(editor: vscode.TextEditor) {
    const hovers: vscode.Hover[] | undefined = await getHoversAtCurrentPositionInEditor(editor);
    let FQNCopied = false;
    if (hovers && hovers.length > 0) {
        const parts = (hovers)
            .flatMap(hover => hover.contents)
            .map(content => getMarkdown(content as vscode.MarkedString))
            .filter(content => content.length > 0);

        if (parts && parts.length > 0) {
            parts.forEach((part: string) => {
                if ((part.startsWith('\n```') || part.startsWith('```')) && part.endsWith('\n```\n')) {
                    part = part.replace(/^\n```.+\n/, '').replace(/^```.+\n/, '').replace(/\n```\n$/, '');
                    if (part) {
                        vscode.env.clipboard.writeText(enhanceFQN(editor, part));
                        FQNCopied = true;
                        return;
                    }
                }
            });
        }
    }
    if (!FQNCopied) {
        vscode.window.showWarningMessage('Fully Qualified Name not available at cursor!');
    }
}

function getHoversAtCurrentPositionInEditor(editor: vscode.TextEditor) {
    return vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        editor.document.uri,
        editor.selection.active);
}

function getMarkdown(content: vscode.MarkedString): string {
    if (typeof content === 'string') {
        return content;
    } else if (content instanceof vscode.MarkdownString) {
        return content.value;
    } else {
        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(content.value, content.language);
        return markdown.value;
    }
}

function enhanceFQN(editor: vscode.TextEditor, part: string): string {
    if (editor.document.languageId === 'java') {
        if (part.indexOf(' ') === -1) {
            // Typename
            return part;
        }

        if (part.indexOf('(') !== -1) {
            // Method - 处理Java方法签名
            // 匹配模式: [修饰符] [返回类型] [完全限定方法名](参数) [throws 异常]
            // 我们需要提取: [完全限定方法名](参数) - 不包含throws子句
            
            // 更精确的正则表达式来匹配Java方法签名
            // 匹配: 任意单词(返回类型) + 空格 + 包含至少一个点的完全限定方法名 + 参数，忽略throws部分
            const fqnMethodMatch = /^.*?\b\w+\s+([a-zA-Z_$][a-zA-Z0-9_$]*\.[a-zA-Z_$][a-zA-Z0-9_$.]*\([^)]*\))(?:\s+throws\s+.+)?.*$/.exec(part);
            if (fqnMethodMatch && fqnMethodMatch.length > 1) {
                return fqnMethodMatch[1];
            }
            
            // 如果没有找到完全限定名，尝试匹配简单的方法签名，同样移除throws
            const simpleMethodMatch = /^.*\s+([a-zA-Z_$][a-zA-Z0-9_$]*\([^)]*\))(?:\s+throws\s+.+)?.*$/.exec(part);
            if (simpleMethodMatch && simpleMethodMatch.length > 1) {
                return simpleMethodMatch[1];
            }
            
            // 如果上面的模式都不匹配，使用原来的逻辑作为后备，但也要移除throws
            const matches = /^.*\s+([\S]+\(.+?\))(?:\s+throws\s+.+)?.*$/.exec(part);
            if (matches && matches.length > 1) {
                return matches[1];
            }
        }

        const dashIndex = part.indexOf(' -');
        if (dashIndex !== -1) {
            part = part.substring(0, dashIndex);
            return part;
        }

        // Bummer - does not work for fields
    }
    return part;
}