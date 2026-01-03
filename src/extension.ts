'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { debug, error, info, initLogger, warn } from './logger';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // 创建输出通道并初始化日志模块
    const outputChannel = vscode.window.createOutputChannel('IDEA Shortcut Key');
    context.subscriptions.push(outputChannel);
    initLogger(outputChannel);

    info('Extension "idea-shortcut-key" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerTextEditorCommand('idea-shortcut-key.copyReference', copyReference);
    const fileDisposable = vscode.commands.registerCommand('idea-shortcut-key.copyFileReference', copyFileReference);

    debug('Registered commands: copyReference, copyFileReference');

    context.subscriptions.push(disposable, fileDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
}

/**
 * 获取指定位置的引用（核心逻辑，供 API 和命令共用）
 * @param vscodeUriPath vscode.Uri.path 属性值（如 /path/to/file.java 或 jdt://contents/...）
 * @param line 行号（0-based）
 * @param character 列号（0-based）
 * @returns 引用文本和类型
 */
async function getReference(vscodeUriPath: string, line: number, character: number): Promise<{ reference: string; type: string }> {
    debug(`getReference called: vscodeUriPath=${vscodeUriPath}, line=${line}, character=${character}`);

    // 根据 path 格式判断并创建 vscode.Uri
    // - jdt:// 开头的是 class 文件，需要用 parse
    // - file:// 开头的是已经编码的 URI，需要用 parse
    // - 其他情况是普通文件路径，用 file
    let uri: vscode.Uri;
    if (vscodeUriPath.startsWith('jdt:') || vscodeUriPath.startsWith('file:')) {
        // 已经是 URI 格式，直接解析
        uri = vscode.Uri.parse(vscodeUriPath);
        debug(`URI parsed from URI string: ${uri.toString()}`);
    } else {
        // 文件系统路径，需要转换为 URI
        uri = vscode.Uri.file(vscodeUriPath);
        debug(`URI created from file path: ${uri.toString()}`);
    }

    const position = new vscode.Position(line, character);

    // 打开文档
    debug(`Opening document...`);
    const document = await vscode.workspace.openTextDocument(uri);
    debug(`Document opened: ${document.uri.toString()}`);

    // 默认返回：相对路径:行号
    const fallbackPath = () => {
        const pathWithLine = getSourceRelativePathWithLine(document.uri, position);
        debug(`Returning fallback path: ${pathWithLine}`);
        return { reference: pathWithLine, type: 'path' };
    };

    // 检查文件扩展名，非 Java/Class 文件直接返回路径
    const fileExtension = document.uri.path.split('.').pop()?.toLowerCase();
    const isJavaFile = fileExtension === 'java' || fileExtension === 'class';
    debug(`File extension: ${fileExtension}, isJavaFile=${isJavaFile}`);

    if (isJavaFile) {
        // Java/Class 文件，优先使用 Go to Definition 获取定义位置
        debug(`Executing definition provider...`);
        const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
            'vscode.executeDefinitionProvider',
            document.uri,
            position
        );
        debug(`Definition provider returned ${definitions?.length ?? 0} definitions`);
        if (definitions && definitions.length > 0) {
            // 有定义（1个或多个），对第一个定义位置取 Reference
            const definition = definitions[0];
            const targetUri = 'targetUri' in definition ? definition.targetUri : (definition as vscode.Location).uri;
            const targetRange = 'targetSelectionRange' in definition
                ? definition.targetSelectionRange
                : ('targetRange' in definition ? definition.targetRange : (definition as vscode.Location).range);
            debug(`Definition target: uri=${targetUri.toString()}, range=${targetRange?.start.line}:${targetRange?.start.character}`);

            const reference = await getReferenceAtLocation(targetUri, targetRange?.start ?? position);
            if (reference) {
                debug(`Reference resolved: ${reference}`);
                return { reference, type: 'symbol' };
            }

        }
    }
    return fallbackPath();
}


/**
 * 复制当前光标位置的引用 (IDEA Copy Reference 风格)
 * - 默认返回相对路径:行号格式
 * - 只有 .java 和 .class 文件才使用lsp符号解析
 * - 优先使用 Go to Definition 获取光标所在符号的定义位置
 * - 如果定义只有一个，对定义位置取 Reference
 * - 如果定义有多个，对当前位置取 Reference
 */
async function copyReference(editor: vscode.TextEditor) {
    debug('copyReference command triggered');
    const document = editor.document;
    const position = editor.selection.active;

    debug(`Document URI: ${document.uri.toString()}`);
    debug(`Cursor position: line=${position.line}, character=${position.character}`);

    // 复用 getReference 核心逻辑，使用完整的 URI 字符串
    const result = await getReference(document.uri.toString(), position.line, position.character);

    info(`Copied reference: ${result.reference} (type: ${result.type})`);
    await vscode.env.clipboard.writeText(result.reference);
}

/**
 * 获取指定位置的符号引用
 */
async function getReferenceAtLocation(uri: vscode.Uri, position: vscode.Position): Promise<string | null> {
    debug(`getReferenceAtLocation: uri=${uri.toString()}, position=${position.line}:${position.character}`);

    // 打开文档获取包名
    const document = await vscode.workspace.openTextDocument(uri);

    // 使用 DocumentSymbol 获取文档符号
    debug('Executing document symbol provider...');
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
    );

    if (!symbols || symbols.length === 0) {
        debug('No symbols found in document');
        return null;
    }
    debug(`Found ${symbols.length} top-level symbols`);

    // 查找位置所在的符号链（从外层到内层）
    const symbolChain = findSymbolChainAtPosition(symbols, position);

    if (symbolChain.length === 0) {
        debug('No symbol chain found at position');
        return null;
    }
    debug(`Symbol chain: ${symbolChain.map(s => s.name).join(' -> ')}`);

    // 检查最内层符号是否精确匹配目标位置
    // 如果 selectionRange 不包含目标位置，说明目标是局部变量等非顶层符号
    const innerSymbol = symbolChain[symbolChain.length - 1];
    if (!innerSymbol.selectionRange.contains(position)) {
        // 目标位置不在符号名称上（如局部变量、方法体内的代码）
        debug('Position not on symbol name (possibly local variable)');
        return null;
    }

    // 构建 IDEA 风格的引用
    const reference = await buildIdeaReference(symbolChain, document);
    debug(`Built IDEA reference: ${reference}`);
    return reference;
}

/**
 * 获取源码相对路径和行号
 * 格式: com/demo/testsen/config/ElasticSearchConfig.java:142
 */
function getSourceRelativePathWithLine(uri: vscode.Uri, position: vscode.Position): string {
    const relativePath = getSourceRelativePath(uri);
    const lineNumber = position.line + 1; // 行号从1开始
    return `${relativePath}:${lineNumber}`;
}

/**
 * 获取源码相对路径（从 src/main/java 或 src/test/java 后开始）
 * 返回格式: com/demo/testsen/config/ElasticSearchConfig.java
 */
function getSourceRelativePath(uri: vscode.Uri): string {
    // 获取文件的完整路径
    const fullPath = uri.fsPath.replace(/\\/g, '/');
    debug(`getSourceRelativePath fullPath: ${fullPath}`);

    // 尝试匹配常见的 Java 源码目录模式
    const sourcePatterns = [
        /.*\/src\/main\/java\/(.+)$/,
        /.*\/src\/test\/java\/(.+)$/,
        /.*\/src\/main\/kotlin\/(.+)$/,
        /.*\/src\/test\/kotlin\/(.+)$/,
        /.*\/src\/(.+)$/,
        /.*\/java\/(.+)$/,
    ];

    for (const pattern of sourcePatterns) {
        const match = pattern.exec(fullPath);
        if (match && match[1]) {
            return match[1];
        }
    }

    // 如果没有匹配到，尝试从工作区相对路径获取
    const workspaceRelativePath = vscode.workspace.asRelativePath(uri, false);
    return workspaceRelativePath.replace(/\\/g, '/');
}

/**
 * 递归查找包含指定位置的符号链
 * 返回从外层到内层的符号数组
 */
function findSymbolChainAtPosition(
    symbols: vscode.DocumentSymbol[],
    position: vscode.Position
): vscode.DocumentSymbol[] {
    for (const symbol of symbols) {
        if (symbol.range.contains(position)) {
            // 打印符号的 range 与 selectionRange
            debug(`Symbol: ${symbol.name}, kind: ${vscode.SymbolKind[symbol.kind]}, range: [${symbol.range.start.line}:${symbol.range.start.character} - ${symbol.range.end.line}:${symbol.range.end.character}], selectionRange: [${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character} - ${symbol.selectionRange.end.line}:${symbol.selectionRange.end.character}]`);
            // 检查是否光标精确在符号名称上
            const isOnSymbolName = symbol.selectionRange.contains(position);

            if (isOnSymbolName) {
                return [symbol];
            }

            // 递归查找子符号
            if (symbol.children && symbol.children.length > 0) {
                const childChain = findSymbolChainAtPosition(symbol.children, position);
                if (childChain.length > 0) {
                    return [symbol, ...childChain];
                }
            }

            // 光标在符号范围内但不在任何子符号上
            return [symbol];
        }
    }
    return [];
}

/**
 * 构建 IDEA 风格的引用
 * - 类: com.example.MyClass
 * - 内部类: com.example.MyClass.InnerClass
 * - 方法: com.example.MyClass#methodName (无重载时)
 * - 方法: com.example.MyClass#methodName(java.lang.String, int) (有重载时，参数为全限定名)
 * - 字段: com.example.MyClass#fieldName
 */
async function buildIdeaReference(symbolChain: vscode.DocumentSymbol[], document: vscode.TextDocument): Promise<string | null> {
    debug(`buildIdeaReference:  symbolChain=${symbolChain.map(s => s.name).join(' -> ')}`);

    if (symbolChain.length === 0) {
        debug('Empty symbol chain');
        return null;
    }

    const lastSymbol = symbolChain[symbolChain.length - 1];
    const lastSymbolKind = lastSymbol.kind;
    debug(`Last symbol: ${lastSymbol.name}, kind=${vscode.SymbolKind[lastSymbolKind]}`);

    // 通过解析 uri.toString() 获取外部类名
    let fullyQualifiedClassName;
    const uri = document.uri;
    if (uri.scheme === 'jdt') {
        fullyQualifiedClassName = parseClassFQNFromJdtUri(uri);
    } else {
        let fileFqnName = getFqnByFilePath(uri);
        // 从 symbolChain 构建完整的类名（包括内部类）
        fullyQualifiedClassName = fileFqnName;
        if (fullyQualifiedClassName) {
            // 从索引 1 开始遍历，构建内部类路径
            for (let i = 1; i < symbolChain.length; i++) {
                const symbol = symbolChain[i];
                if (isTypeSymbol(symbol.kind)) {
                    fullyQualifiedClassName += '.' + symbol.name;
                }
            }
        }
    }

    debug(`Class name from URI: ${fullyQualifiedClassName}`);

    if (!fullyQualifiedClassName) {
        debug('Could not parse class name from URI');
        return null;
    }
    debug(`Fully qualified class name: ${fullyQualifiedClassName}`);

    // 根据最后一个符号的类型决定输出格式
    if (isTypeSymbol(lastSymbolKind)) {
        // 类/接口/枚举 - 返回完全限定类名
        debug('Symbol is a type, returning class name');
        return fullyQualifiedClassName;
    } else if (isMemberSymbol(lastSymbolKind)) {
        // 获取成员名，对于方法需要检查是否存在重载
        const memberName = await getMemberReference(lastSymbol, symbolChain, document);
        debug(`Member reference: ${memberName}`);

        return `${fullyQualifiedClassName}#${memberName}`;
    }

    // 其他类型，返回完全限定类名
    debug('Unknown symbol type, returning class name');
    return fullyQualifiedClassName;
}

/**
 * 通过文件路径获取全限定类名
 * 将相对路径转换为包名格式：com/example/MyClass.java -> com.example.MyClass
 */
function getFqnByFilePath(uri: vscode.Uri): string | null {
    const relativePath = getSourceRelativePath(uri);
    debug(`getFqnByFilePath relativePath: ${relativePath}`);
    if (!relativePath) {
        return null;
    }
    return relativePath
        .replace(/\//g, '.')
        .replace(/\.(java|class)$/, '');
}

/**
 * 获取成员的引用名称
 * 对于方法：如果存在重载则包含参数类型（通过 Go to Type Definition 获取全限定名）
 * 对于字段/常量：直接返回名称
 */
async function getMemberReference(
    symbol: vscode.DocumentSymbol,
    symbolChain: vscode.DocumentSymbol[],
    document: vscode.TextDocument
): Promise<string> {
    // 只有方法和构造函数才需要检查重载
    if (symbol.kind === vscode.SymbolKind.Method || symbol.kind === vscode.SymbolKind.Constructor) {
        const methodName = extractMethodName(symbol.name);

        // 找到所属的类符号
        const ownerClass = findOwnerClass(symbolChain);
        if (ownerClass) {
            // 检查是否存在重载方法
            const hasOverload = checkMethodOverload(ownerClass, methodName);
            if (hasOverload) {
                // 存在重载，使用 Go to Type Definition 获取全限定参数类型
                const fqnParams = await resolveParamsWithTypeDefinition(symbol, document);
                return `${methodName}(${fqnParams})`;
            }
        }

        // 不存在重载，只返回方法名
        return methodName;
    }

    // 字段/常量等直接返回名称
    return symbol.name;
}

/**
 * 使用 Go to Type Definition 解析方法参数的全限定类型名
 */
async function resolveParamsWithTypeDefinition(
    methodSymbol: vscode.DocumentSymbol,
    document: vscode.TextDocument
): Promise<string> {
    debug(`resolveParamsWithTypeDefinition: method=${methodSymbol.name}`);

    // 获取方法声明的源代码范围
    const methodRange = methodSymbol.range;
    const methodText = document.getText(methodRange);
    debug(`Method text (first 200 chars): ${methodText.substring(0, 200).replace(/\n/g, '\\n')}`);

    // 计算 selectionRange 结束位置相对于 range 开始的偏移量
    // selectionRange 是方法名的精确范围，参数列表的 ( 在方法名之后
    // 这样可以避免 JavaDoc 或注释中的 () 干扰
    const selectionEndOffset = calculateOffsetInText(
        document,
        methodRange.start,
        methodSymbol.selectionRange.end
    );
    debug(`Selection range end offset: ${selectionEndOffset}`);

    // 从 selectionRange 结束位置之后找第一个 (
    const parenStart = methodText.indexOf('(', selectionEndOffset);
    const parenEnd = findMatchingParen(methodText, parenStart);
    debug(`Paren positions: start=${parenStart}, end=${parenEnd}`);

    if (parenStart === -1 || parenEnd === -1) {
        // 无法解析，返回原始参数
        debug('Could not find matching parentheses, using fallback');
        return extractParamsFromSymbolName(methodSymbol.name);
    }

    const paramsText = methodText.substring(parenStart + 1, parenEnd);
    debug(`Params text: "${paramsText}"`);
    if (!paramsText.trim()) {
        debug('No parameters found');
        return ''; // 无参数
    }

    // 解析每个参数
    const params = splitMethodParams(paramsText);
    debug(`Split params: ${JSON.stringify(params)}`);
    const resolvedTypes: string[] = [];

    // 方法起始位置
    const methodStartLine = methodRange.start.line;
    const methodStartChar = methodRange.start.character;
    debug(`Method start position: line=${methodStartLine}, char=${methodStartChar}`);

    // 参数列表在方法文本中的起始位置
    let currentOffset = parenStart + 1;

    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        debug(`Processing param[${i}]: "${param}", currentOffset=${currentOffset}`);

        // 跳过空白
        while (currentOffset < parenEnd && /\s/.test(methodText[currentOffset])) {
            currentOffset++;
        }
        debug(`After skipping whitespace, currentOffset=${currentOffset}`);

        // 解析参数：可能有注解、类型、变量名
        const paramInfo = parseMethodParam(param);
        debug(`Parsed param info: typeName="${paramInfo.typeName}", isVarArgs=${paramInfo.isVarArgs}, arrayDimension="${paramInfo.arrayDimension}"`);

        if (!paramInfo.typeName) {
            debug(`No type name found, using raw param`);
            resolvedTypes.push(param.trim());
            currentOffset += param.length + 1; // +1 for comma
            continue;
        }

        // 找到类型在参数文本中的位置
        const typeStartInParam = param.indexOf(paramInfo.typeName);
        const typePositionInMethod = currentOffset + typeStartInParam;
        debug(`Type position: typeStartInParam=${typeStartInParam}, typePositionInMethod=${typePositionInMethod}`);

        // 计算类型在文档中的精确位置
        const position = calculatePosition(methodText, typePositionInMethod, methodStartLine, methodStartChar);
        debug(`Calculated document position: line=${position.line}, char=${position.character}`);

        // 使用 Go to Type Definition 获取全限定名
        const fqn = await getTypeDefinitionFQN(document.uri, position, paramInfo.typeName);
        debug(`Resolved FQN for "${paramInfo.typeName}": ${fqn}`);

        // 处理数组和可变参数
        let resolvedType = fqn;
        if (paramInfo.isVarArgs) {
            resolvedType += '[]';
        } else if (paramInfo.arrayDimension) {
            resolvedType += paramInfo.arrayDimension;
        }

        resolvedTypes.push(resolvedType);
        currentOffset += param.length + 1; // +1 for comma
    }

    debug(`Final resolved types: ${JSON.stringify(resolvedTypes)}`);
    return resolvedTypes.join(', ');
}

/**
 * 检查目标位置是否是泛型类型参数声明
 * 例如: public static<T> String method(T param) 中，T 的定义指向 <T> 中的 T
 * 
 * @param uri 文档 URI
 * @param position 目标位置
 * @param expectedName 预期的类型名称
 * @returns 如果是泛型类型参数声明返回 true
 */
async function checkIsGenericTypeParameter(uri: vscode.Uri, position: vscode.Position, expectedName: string): Promise<boolean> {
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const line = doc.lineAt(position.line).text;

        // 检查目标位置处的标识符是否匹配 expectedName
        // 从 position.character 开始向左右扩展找到完整的标识符
        let start = position.character;
        let end = position.character;

        // 向左找标识符起始位置
        while (start > 0 && /[a-zA-Z0-9_$]/.test(line[start - 1])) {
            start--;
        }
        // 向右找标识符结束位置
        while (end < line.length && /[a-zA-Z0-9_$]/.test(line[end])) {
            end++;
        }

        const identifierAtPos = line.substring(start, end);
        debug(`checkIsGenericTypeParameter: position=${position.line}:${position.character}, identifierAtPos="${identifierAtPos}", expectedName="${expectedName}"`);

        if (identifierAtPos !== expectedName) {
            return false;
        }

        // 检查这个标识符是否在泛型声明 < > 中
        // 向左查找是否有 < 且没有被 > 关闭
        let depth = 0;
        for (let i = start - 1; i >= 0; i--) {
            const ch = line[i];
            if (ch === '>') {
                depth++;
            } else if (ch === '<') {
                if (depth === 0) {
                    // 找到未闭合的 <，说明标识符在泛型声明中
                    debug(`checkIsGenericTypeParameter: found opening < at position ${i}, this is a generic type parameter`);
                    return true;
                }
                depth--;
            }
        }

        debug(`checkIsGenericTypeParameter: not inside generic declaration`);
        return false;
    } catch (e) {
        debug(`checkIsGenericTypeParameter error: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }
}

/**
 * 通过 Go to Type Definition 获取类型的全限定名
 */
async function getTypeDefinitionFQN(uri: vscode.Uri, position: vscode.Position, fallbackName: string): Promise<string> {
    debug(`getTypeDefinitionFQN: uri=${uri.toString()}, position=${position.line}:${position.character}, fallbackName="${fallbackName}"`);

    try {
        debug(`Executing vscode.executeTypeDefinitionProvider...`);
        const typeDefinitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
            'vscode.executeTypeDefinitionProvider',
            uri,
            position
        );
        debug(`Type definition provider returned ${typeDefinitions?.length ?? 0} definitions`);

        if (typeDefinitions && typeDefinitions.length > 0) {
            const typeDef = typeDefinitions[0];
            const targetUri = 'targetUri' in typeDef ? typeDef.targetUri : (typeDef as vscode.Location).uri;
            const targetRange = 'targetRange' in typeDef ? typeDef.targetRange : (typeDef as vscode.Location).range;
            debug(`Type definition target: uri=${targetUri.toString()}, range=${targetRange?.start.line}:${targetRange?.start.character}`);

            // 检查是否是泛型类型参数：当 type definition 指向同一文件时，可能是泛型参数声明
            // 泛型参数声明通常在 <T> 中，此时 fallbackName 就是泛型参数名
            if (targetUri.toString() === uri.toString() && targetRange) {
                const isGenericTypeParam = await checkIsGenericTypeParameter(targetUri, targetRange.start, fallbackName);
                if (isGenericTypeParam) {
                    debug(`Detected generic type parameter, returning fallbackName: ${fallbackName}`);
                    return fallbackName;
                }
            }

            // 从目标文件获取全限定类名
            const fqn = await getClassFQNFromUri(targetUri);
            debug(`getClassFQNFromUri returned: ${fqn}`);
            if (fqn) {
                return fqn;
            }
        } else {
            debug(`No type definitions found, will use fallback`);
        }
    } catch (e) {
        // 忽略错误，使用 fallback
        debug(`Error executing type definition provider: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 如果无法获取，检查是否是基本类型
    const primitiveTypes = ['int', 'long', 'double', 'float', 'boolean', 'byte', 'short', 'char', 'void'];
    if (primitiveTypes.includes(fallbackName)) {
        debug(`Using primitive type: ${fallbackName}`);
        return fallbackName;
    }

    // 检查是否是 java.lang 包的类
    const javaLangClasses = [
        'String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Byte', 'Short', 'Character',
        'Object', 'Class', 'System', 'Math', 'StringBuilder', 'StringBuffer',
        'Exception', 'RuntimeException', 'Error', 'Throwable', 'Number', 'Void'
    ];
    if (javaLangClasses.includes(fallbackName)) {
        const result = `java.lang.${fallbackName}`;
        debug(`Using java.lang fallback: ${result}`);
        return result;
    }

    debug(`No special handling, returning fallbackName: ${fallbackName}`);
    return fallbackName;
}

/**
 * 从 URI 获取类的全限定名
 */
async function getClassFQNFromUri(uri: vscode.Uri): Promise<string | null> {
    debug(`getClassFQNFromUri: uri=${uri.toString()}`);

    // 对于 JDT URI，优先从路径中解析类名（更可靠）
    // 格式: jdt://contents/rt.jar/java.lang/Class.class?...
    if (uri.scheme === 'jdt') {
        const fqnFromPath = parseClassFQNFromJdtUri(uri);
        if (fqnFromPath) {
            debug(`Parsed FQN from JDT URI path: ${fqnFromPath}`);
            return fqnFromPath;
        }
    }

    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const content = doc.getText();
        debug(`Document content length: ${content.length}`);
        debug(`Document content (first 300 chars): ${content.substring(0, 300).replace(/\n/g, '\\n')}`);

        // 提取包名
        const packageMatch = /^\s*package\s+([a-zA-Z_$][\w.$]*)\s*;/m.exec(content);
        const packageName = packageMatch ? packageMatch[1] : '';
        debug(`Extracted package name: "${packageName}"`);

        // 提取类名 - 使用更严格的正则，匹配类声明（带修饰符）
        // 匹配格式: [修饰符] class/interface/enum ClassName
        const classMatch = /(?:^|\n)\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+|static\s+)*(?:class|interface|enum)\s+([A-Z][\w$]*)/m.exec(content);
        const className = classMatch ? classMatch[1] : null;
        debug(`Extracted class name: "${className}"`);

        if (className) {
            const result = packageName ? `${packageName}.${className}` : className;
            debug(`Returning FQN: ${result}`);
            return result;
        }
        debug(`No class name found`);
    } catch (e) {
        // 忽略错误
        debug(`Error in getClassFQNFromUri: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
}

/**
 * 从 JDT URI 路径中解析类的全限定名
 * JDT URI 格式: jdt://contents/jarName/package.name/ClassName.class?...
 * 内部类格式: jdt://contents/jarName/package.name/OuterClass$InnerClass.class
 * 
 * 注意：此方法只能解析 URI 路径中的类名，无法处理以下情况：
 * - 如果 Type Definition 指向外部类文件中的内部类声明位置，URI 路径是外部类，
 *   此时返回 null，让调用者回退到从文档内容解析
 */
function parseClassFQNFromJdtUri(uri: vscode.Uri): string | null {
    try {
        const path = uri.path;
        debug(`Parsing JDT URI path: ${path}`);

        // 路径格式: /contents/rt.jar/java.lang/Class.class 或类似格式
        // 也可能是: /contents/spring-web-5.3.25.jar/org.springframework.web.client/RestTemplate.class
        // 内部类: /contents/xxx.jar/package.name/OuterClass$InnerClass.class
        const parts = path.split('/').filter(p => p.length > 0);
        debug(`Path parts: ${JSON.stringify(parts)}`);

        // 期望格式: ["jarName", "package.name", "ClassName.class"]
        if (parts.length >= 3) {
            const packageName = parts[parts.length - 2]; // 倒数第二个是包名
            const classFileName = parts[parts.length - 1]; // 最后一个是类文件名

            // 移除 .class 后缀获取类名
            let className = classFileName.replace(/\.class$/, '');

            // 处理内部类：将 $ 替换为 . 
            // OuterClass$InnerClass -> OuterClass.InnerClass
            // OuterClass$Inner1$Inner2 -> OuterClass.Inner1.Inner2
            className = className.replace(/\$/g, '.');

            if (packageName && className) {
                const fqn = `${packageName}.${className}`;
                debug(`Parsed FQN from path: packageName=${packageName}, className=${className}, fqn=${fqn}`);
                return fqn;
            }
        }
    } catch (e) {
        debug(`Error parsing JDT URI: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
}

/**
 * 解析方法参数，提取类型信息
 */
function parseMethodParam(param: string): { typeName: string; isVarArgs: boolean; arrayDimension: string } {
    param = param.trim();

    // 移除注解
    param = param.replace(/@[\w.]+(\([^)]*\))?\s*/g, '');

    // 检查可变参数
    const isVarArgs = param.includes('...');
    if (isVarArgs) {
        param = param.replace('...', '').trim();
    }

    // 检查数组维度
    let arrayDimension = '';
    const arrayMatch = /(\[\])+/.exec(param);
    if (arrayMatch) {
        arrayDimension = arrayMatch[0];
        param = param.replace(/\[\]/g, '').trim();
    }

    // 分割类型和变量名
    const parts = param.split(/\s+/);

    // 移除泛型获取基础类型名
    let typeName = parts[0] || '';
    const genericIndex = typeName.indexOf('<');
    if (genericIndex !== -1) {
        typeName = typeName.substring(0, genericIndex);
    }

    return { typeName, isVarArgs, arrayDimension };
}

/**
 * 找到匹配的右括号
 */
function findMatchingParen(text: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        if (text[i] === '(') {
            depth++;
        } else if (text[i] === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * 分割方法参数（考虑泛型和注解）
 */
function splitMethodParams(paramsText: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0; // 泛型深度
    let parenDepth = 0; // 括号深度（注解参数）

    for (const char of paramsText) {
        if (char === '<') {
            depth++;
        } else if (char === '>') {
            depth--;
        } else if (char === '(') {
            parenDepth++;
        } else if (char === ')') {
            parenDepth--;
        } else if (char === ',' && depth === 0 && parenDepth === 0) {
            result.push(current);
            current = '';
            continue;
        }
        current += char;
    }

    if (current.trim()) {
        result.push(current);
    }

    return result;
}

/**
 * 计算从 rangeStart 到 targetPosition 在文本中的字符偏移量
 * 用于将 selectionRange.end 转换为在 methodText 中的偏移
 */
function calculateOffsetInText(
    document: vscode.TextDocument,
    rangeStart: vscode.Position,
    targetPosition: vscode.Position
): number {
    // 使用 VS Code 提供的 offsetAt API，自动处理换行符（LF 或 CRLF）
    return document.offsetAt(targetPosition) - document.offsetAt(rangeStart);
}

/**
 * 计算文本中某个偏移位置对应的文档位置
 */
function calculatePosition(text: string, offset: number, startLine: number, startChar: number): vscode.Position {
    let line = startLine;
    let char = startChar;

    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            char = 0;
        } else {
            char++;
        }
    }

    return new vscode.Position(line, char);
}

/**
 * 从符号名称中提取参数部分
 */
function extractParamsFromSymbolName(symbolName: string): string {
    const match = /\(([^)]*)\)/.exec(symbolName);
    return match ? match[1] : '';
}

/**
 * 从方法签名中提取方法名
 * methodName(params) -> methodName
 */
function extractMethodName(fullName: string): string {
    const parenIndex = fullName.indexOf('(');
    if (parenIndex !== -1) {
        return fullName.substring(0, parenIndex);
    }
    return fullName;
}

/**
 * 在符号链中找到所属的类符号
 */
function findOwnerClass(symbolChain: vscode.DocumentSymbol[]): vscode.DocumentSymbol | null {
    // 从后往前找，跳过最后一个（当前符号），找到第一个类型符号
    for (let i = symbolChain.length - 2; i >= 0; i--) {
        if (isTypeSymbol(symbolChain[i].kind)) {
            return symbolChain[i];
        }
    }
    return null;
}

/**
 * 检查类中是否存在同名的重载方法
 */
function checkMethodOverload(classSymbol: vscode.DocumentSymbol, methodName: string): boolean {
    if (!classSymbol.children) {
        return false;
    }

    // 统计同名方法的数量
    let count = 0;
    for (const child of classSymbol.children) {
        if (child.kind === vscode.SymbolKind.Method || child.kind === vscode.SymbolKind.Constructor) {
            const childMethodName = extractMethodName(child.name);
            if (childMethodName === methodName) {
                count++;
                if (count > 1) {
                    return true; // 找到重载
                }
            }
        }
    }

    return false;
}

/**
 * 判断符号是否为类型符号（类、接口、枚举）
 */
function isTypeSymbol(kind: vscode.SymbolKind): boolean {
    return kind === vscode.SymbolKind.Class ||
        kind === vscode.SymbolKind.Interface ||
        kind === vscode.SymbolKind.Enum;
}

/**
 * 判断符号是否为成员符号（方法、字段、常量）
 */
function isMemberSymbol(kind: vscode.SymbolKind): boolean {
    return kind === vscode.SymbolKind.Method ||
        kind === vscode.SymbolKind.Constructor ||
        kind === vscode.SymbolKind.Field ||
        kind === vscode.SymbolKind.Property ||
        kind === vscode.SymbolKind.Constant ||
        kind === vscode.SymbolKind.EnumMember;
}

// 复制文件的全限定名
async function copyFileReference(uri?: vscode.Uri) {
    debug('copyFileReference command triggered');
    let targetUri: vscode.Uri | undefined = uri;

    // 如果没有传入URI，尝试从不同的上下文获取
    if (!targetUri) {
        // 首先尝试从命令参数获取（当从资源管理器右键菜单调用时）
        const args = arguments;
        if (args && args.length > 0 && args[0] && args[0].fsPath) {
            targetUri = args[0];
            debug('Got URI from command arguments');
        }
        // 如果还是没有，尝试从当前活动编辑器获取
        else if (vscode.window.activeTextEditor) {
            targetUri = vscode.window.activeTextEditor.document.uri;
            debug('Got URI from active editor');
        }
    } else {
        debug('Got URI from parameter');
    }

    if (!targetUri) {
        warn('No file selected for copyFileReference');
        vscode.window.showWarningMessage('No file selected! Please select a file in the explorer or open a file in the editor.');
        return;
    }

    debug(`Target URI: ${targetUri.toString()}`);
    const fqn = await getFileReference(targetUri);
    if (fqn) {
        info(`Copied file reference: ${fqn}`);
        await vscode.env.clipboard.writeText(fqn);
    } else {
        warn('Could not determine file FQN');
        vscode.window.showWarningMessage('Could not determine file FQN!');
    }
}

// 获取文件的全限定名
async function getFileReference(uri: vscode.Uri): Promise<string | null> {
    debug(`getFileReference: uri=${uri.toString()}`);

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        debug('File is not in any workspace folder');
        return null;
    }
    debug(`Workspace folder: ${workspaceFolder.uri.toString()}`);

    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const fileExtension = uri.path.split('.').pop()?.toLowerCase();
    debug(`Relative path: ${relativePath}, extension: ${fileExtension}`);

    // 处理Java文件
    if (fileExtension === 'java') {
        debug('Processing as Java file');
        return getJavaFileReference(uri, workspaceFolder, relativePath);
    }

    // 处理其他类型的文件，返回相对路径
    const result = relativePath.replace(/\\/g, '/');
    debug(`Non-Java file, returning relative path: ${result}`);
    return result;
}

// 获取Java文件的全限定类名
async function getJavaFileReference(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder, relativePath: string): Promise<string | null> {
    debug(`getJavaFileReference: uri=${uri.toString()}`);

    try {
        // 读取文件内容来获取包名
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();

        // 提取包名
        const packageMatch = /^\s*package\s+([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*;/m.exec(content);
        const packageName = packageMatch ? packageMatch[1] : '';
        debug(`Extracted package name: ${packageName || '(default package)'}`);

        // 获取类名（文件名去掉扩展名）
        const fileName = uri.path.split('/').pop();
        const className = fileName ? fileName.replace(/\.java$/, '') : '';
        debug(`Class name from filename: ${className}`);

        if (!className) {
            debug('Could not determine class name');
            return null;
        }

        // 组合完全限定类名
        const fqn = packageName ? `${packageName}.${className}` : className;
        debug(`Fully qualified name: ${fqn}`);
        return fqn;

    } catch (err) {
        error(`Error reading Java file: ${err instanceof Error ? err.message : String(err)}`);

        // 如果无法读取文件内容，尝试从路径推断
        debug('Falling back to path inference');
        return inferJavaReferenceFromPath(relativePath);
    }
}

// 从文件路径推断Java类的全限定名
function inferJavaReferenceFromPath(relativePath: string): string | null {
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