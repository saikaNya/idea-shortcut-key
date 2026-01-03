<div align="center">
    <a href="#zh-readme">中文</a> | <a href="#en-readme">English</a>
</div>

<h1 id="zh-readme">IDEA Shortcut Key Extension</h1>

这是一个VS Code扩展，提供类似IntelliJ IDEA的快捷键功能，有些idea中的快捷键在vscode中没有实现，目前暂时只实现Copy Reference功能。

## 功能特性

### 1. 复制代码符号的全限定名
- 在Java代码中的类名、方法名或字段上使用快捷键
- 自动提取并复制完全限定名到剪贴板
- 支持方法签名重载

### 2. 复制文件的全限定名
- 在文件资源管理器中选中Java文件时使用快捷键
- 自动读取package声明并生成完全限定类名
- 支持从文件路径推断包名（当无法读取文件内容时）

## 使用方法

### 命令
| 命令 | 描述 |
|------|------|
| `idea-shortcut-key.copyReference` | 复制代码符号的全限定名（在编辑器中使用） |
| `idea-shortcut-key.copyFileReference` | 复制文件的全限定类名（在文件资源管理器中使用） |

### 快捷键
- **Windows/Linux**: `Ctrl+Alt+Shift+C`
- **Mac**: `Cmd+Alt+Shift+C`

### 使用场景

#### 1. 在代码编辑器中
将光标放在Java类名、方法名或字段上，按下快捷键即可复制其全限定名。
将光标不在任何符号上时，按下快捷键可复制文件相对路径:行号

**示例**:
```java
public class LinkConvertController {
    public Object search() throws IOException {
        // 光标在 search 方法名上按快捷键
        // 复制结果: packageName.LinkConvertController.search
    }
}
```

#### 2. 在文件资源管理器中
- 在文件资源管理器中选中Java文件
- 按下快捷键复制文件的全限定类名

**示例**:
```
文件路径: src/main/java/packageName/LinkConvertController.java
复制结果: packageName.LinkConvertController
```

---

<h1 id="en-readme">IDEA Shortcut Key Extension</h1>

A VS Code extension that provides IntelliJ IDEA-like shortcut key functionality. Some shortcuts available in IDEA are not implemented in VS Code. Currently, only the Copy Reference feature is implemented.

## Features

### 1. Copy Fully Qualified Name of Code Symbols
- Use the shortcut on class names, method names, or fields in Java code
- Automatically extracts and copies the fully qualified name to clipboard
- Supports method signature overloading

### 2. Copy Fully Qualified Name of Files
- Use the shortcut when a Java file is selected in the file explorer
- Automatically reads the package declaration and generates the fully qualified class name
- Supports inferring package name from file path (when file content cannot be read)

## Usage

### Commands
| Command | Description |
|---------|-------------|
| `idea-shortcut-key.copyReference` | Copy fully qualified name of code symbol (use in editor) |
| `idea-shortcut-key.copyFileReference` | Copy fully qualified class name of file (use in file explorer) |

### Keyboard Shortcuts
- **Windows/Linux**: `Ctrl+Alt+Shift+C`
- **Mac**: `Cmd+Alt+Shift+C`

### Use Cases

#### 1. In the Code Editor
Place the cursor on a Java class name, method name, or field, then press the shortcut to copy its fully qualified name.
When the cursor is not on any symbol, pressing the shortcut will copy the relative file path with line number.

**Example**:
```java
public class LinkConvertController {
    public Object search() throws IOException {
        // Place cursor on the search method name and press shortcut
        // Copied result: packageName.LinkConvertController.search
    }
}
```

#### 2. In the File Explorer
- Select a Java file in the file explorer
- Press the shortcut to copy the file's fully qualified class name

**Example**:
```
File path: src/main/java/packageName/LinkConvertController.java
Copied result: packageName.LinkConvertController
```
