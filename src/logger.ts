import * as vscode from 'vscode';

let _outputChannel: vscode.OutputChannel | undefined;

/**
 * 初始化日志模块
 */
export function initLogger(outputChannel: vscode.OutputChannel): void {
    _outputChannel = outputChannel;
}

/**
 * 获取 OutputChannel 实例
 */
export function getOutputChannel(): vscode.OutputChannel | undefined {
    return _outputChannel;
}

/**
 * 输出日志到 Output Channel
 */
export function log(message: string): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${message}`;

    if (_outputChannel) {
        _outputChannel.appendLine(formattedMessage);
    } else {
        // fallback to console if outputChannel not initialized
        console.log(`[idea-shortcut-key] ${formattedMessage}`);
    }
}

/**
 * 输出调试日志
 * 仅在 idea-shortcut-key.enableDebugInfo 配置开启时输出
 */
export function debug(message: string): void {
    const enableDebugInfo = vscode.workspace.getConfiguration('idea-shortcut-key').get<boolean>('enableDebugInfo', false);
    if (!enableDebugInfo) {
        return;
    }
    log(`[DEBUG] ${message}`);
}

/**
 * 输出错误日志
 */
export function error(message: string): void {
    log(`[ERROR] ${message}`);
}

/**
 * 输出警告日志
 */
export function warn(message: string): void {
    log(`[WARN] ${message}`);
}

/**
 * 输出信息日志
 */
export function info(message: string): void {
    log(`[INFO] ${message}`);
}

