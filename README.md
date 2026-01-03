# IDEA Shortcut Key Extension

这是一个VS Code扩展，提供类似IntelliJ IDEA的快捷键功能，用于复制Java代码的全限定名(FQN)。

## 功能特性

### 1. 复制代码符号的全限定名
- 在Java代码中的类名、方法名或字段上使用快捷键
- 自动提取并复制完全限定名到剪贴板
- 支持方法签名冲重载

### 2. 复制文件的全限定名
- 在文件资源管理器中选中Java文件时使用快捷键
- 自动读取package声明并生成完全限定类名
- 支持从文件路径推断包名（当无法读取文件内容时）

## 使用方法

### 快捷键
- **Windows/Linux**: `Ctrl+Alt+Shift+C`
- **Mac**: `Cmd+Alt+Shift+C`

### 使用场景

#### 1. 在代码编辑器中
将光标放在Java类名、方法名或字段上，按下快捷键即可复制其全限定名。

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
- 或者右键点击Java文件，选择"Copy File FQN"

**示例**:
```
文件路径: src/main/java/packageName/LinkConvertController.java
复制结果: packageName.LinkConvertController
```