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
	const fileDisposable = vscode.commands.registerCommand('idea-shortcut-key.copyFileFQN', copyFileFQN);

	context.subscriptions.push(disposable, fileDisposable);
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

// 复制文件的全限定名
async function copyFileFQN(uri?: vscode.Uri) {
    let targetUri: vscode.Uri | undefined = uri;
    
    // 如果没有传入URI，尝试从不同的上下文获取
    if (!targetUri) {
        // 首先尝试从命令参数获取（当从资源管理器右键菜单调用时）
        const args = arguments;
        if (args && args.length > 0 && args[0] && args[0].fsPath) {
            targetUri = args[0];
        }
        // 如果还是没有，尝试从当前活动编辑器获取
        else if (vscode.window.activeTextEditor) {
            targetUri = vscode.window.activeTextEditor.document.uri;
        }
    }
    
    if (!targetUri) {
        vscode.window.showWarningMessage('No file selected! Please select a file in the explorer or open a file in the editor.');
        return;
    }
    
    const fqn = await getFileFQN(targetUri);
    if (fqn) {
        await vscode.env.clipboard.writeText(fqn);
    } else {
        vscode.window.showWarningMessage('Could not determine file FQN!');
    }
}

// 获取文件的全限定名
async function getFileFQN(uri: vscode.Uri): Promise<string | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        return null;
    }
    
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const fileExtension = uri.path.split('.').pop()?.toLowerCase();
    
    // 处理Java文件
    if (fileExtension === 'java') {
        return getJavaFileFQN(uri, workspaceFolder, relativePath);
    }
    
    // 处理其他类型的文件，返回相对路径
    return relativePath.replace(/\\/g, '.');
}

// 获取Java文件的全限定类名
async function getJavaFileFQN(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder, relativePath: string): Promise<string | null> {
    try {
        // 读取文件内容来获取包名
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();
        
        // 提取包名
        const packageMatch = /^\s*package\s+([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*;/m.exec(content);
        const packageName = packageMatch ? packageMatch[1] : '';
        
        // 获取类名（文件名去掉扩展名）
        const fileName = uri.path.split('/').pop();
        const className = fileName ? fileName.replace(/\.java$/, '') : '';
        
        if (!className) {
            return null;
        }
        
        // 组合完全限定类名
        return packageName ? `${packageName}.${className}` : className;
        
    } catch (error) {
        console.error('Error reading Java file:', error);
        
        // 如果无法读取文件内容，尝试从路径推断
        return inferJavaFQNFromPath(relativePath);
    }
}

// 从文件路径推断Java类的全限定名
function inferJavaFQNFromPath(relativePath: string): string | null {
    // 移除文件扩展名
    let pathWithoutExtension = relativePath.replace(/\.java$/, '');
    
    // 将路径分隔符替换为点
    pathWithoutExtension = pathWithoutExtension.replace(/[/\\]/g, '.');
    
    // 尝试找到src目录并移除之前的部分
    const srcIndex = pathWithoutExtension.indexOf('src.');
    if (srcIndex !== -1) {
        pathWithoutExtension = pathWithoutExtension.substring(srcIndex + 4); // 移除 "src."
    }
    
    // 移除常见的源码目录前缀
    const commonPrefixes = ['main.java.', 'test.java.', 'java.'];
    for (const prefix of commonPrefixes) {
        if (pathWithoutExtension.startsWith(prefix)) {
            pathWithoutExtension = pathWithoutExtension.substring(prefix.length);
            break;
        }
    }
    
    return pathWithoutExtension || null;
}