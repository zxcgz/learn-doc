
> 基于 **CC BY 3.0** 协议的授权翻译与整理。  
> 原文：Google Java Style Guide — https://google.github.io/styleguide/javaguide.html  
> 版权：© Google（原文）；本译文为衍生作品，依据 CC BY 3.0（署名）再分发。  
> 译注：为更贴近中文读者，本译文在不改变技术含义的前提下对个别语句做了顺畅化处理；内嵌示例与术语保持原意。若与原文理解存在歧义，请以英文原文为准。  
> 最后整理：2025-10-13

---

## 1. 前言（Introduction）

本文档完整定义了 Google 在 **Java™** 语言中的编码标准。**仅当**某个 Java 源文件遵循本文所有规则时，才可称其为 *Google Style*。

与其他风格指南类似，本文不仅涉及排版/格式等审美性问题，还覆盖约定与编码规范。但我们主要强调那些**可明确执行**（可由人工或工具统一检查）的“硬规则”，避免给出模糊、无法一致执行的建议。

### 1.1 术语说明（Terminology notes）

除非另有说明：
1. **class（类）**一词是**广义**概念，包含**普通类**、**record 类**、**enum 枚举类**、**interface 接口**以及 **annotation 注解类型**（`@interface`）。
2. **member（成员）**指**嵌套类**、**字段**、**方法**或**构造器**，即除初始化块以外的类的所有最顶层内容。
3. **comment（注释）**专指**实现注释**（implementation comments）。我们不使用“documentation comments”一词，而统一称 **Javadoc**。

本文后续还会在必要处补充术语说明。

### 1.2 指南说明（Guide notes）

文中的示例代码**不具备规范效力**（non‑normative）。示例遵循 Google 风格，但不代表唯一“好看”的写法；示例中出现的**可选**排版选择不应被当作强制规则。

---

## 2. 源文件基础（Source file basics）

### 2.1 文件名（File name）

若源文件内包含类，则**文件名**应为**唯一的**顶层类名（区分大小写）+ 扩展名 `.java`。

### 2.2 文件编码：UTF‑8（File encoding）

源文件使用 **UTF‑8** 编码。

### 2.3 特殊字符（Special characters）

#### 2.3.1 空白字符（Whitespace characters）

除**行终止**序列外，源码中唯一允许出现的空白字符是 **ASCII 空格**（0x20）。这意味着：  
1) 其他所有空白字符在 `char`/字符串文本与 **text block** 中必须使用转义；  
2) **制表符（Tab）不用于缩进**。

#### 2.3.2 特殊转义（Special escape sequences）

对于拥有**特殊转义序列**的字符（`\b`、`\t`、`\n`、`\f`、`\r`、`\s`、`\"`、`\'`、`\\`），**总是**使用该转义，而不是八进制（如 `\012`）或 Unicode 转义（如 `\u000a`）。

#### 2.3.3 非 ASCII 字符（Non‑ASCII characters）

其他非 ASCII 字符可：  
- 直接写为该 **Unicode 字符**（如 `∞`）；或  
- 写为**等价的 Unicode 转义**（如 `\u221e`）。

两者仅以**可读性**为准。**强烈不建议**在字符串与注释之外使用 Unicode 转义。

> **提示**：若使用 Unicode 转义（即使直接写字符时亦然），**补充解释性注释**会很有帮助。

**示例**：
```java
String unitAbbrev = "μs";              // 最佳：无需注释也清楚
String unitAbbrev = "\u03bcs"; // "μs" // 允许，但没有必要
String unitAbbrev = "\u03bcs"; // Greek letter mu, "s" // 允许但别扭且易错
String unitAbbrev = "\u03bcs";         // 较差：读者不知其义
return '\ufeff' + content; // byte order mark // 不可打印字符用转义，并酌情注释
```
> **提示**：不要因为担心“某些工具不支持非 ASCII”而**刻意**牺牲可读性；若工具无法正确处理，那是工具的错误，应予以修复。

---

## 3. 源文件结构（Source file structure）

普通源文件按以下**顺序**组织：  
1) 许可证/版权信息（如有）；  
2) `package` 声明；  
3) `import` 语句；  
4) **且仅有一个**顶层类声明。

各部分之间以**恰好一行空行**分隔。

- `package-info.java`：与普通文件相同，但**没有**类声明。  
- `module-info.java`：**没有** `package` 声明；类声明位置由**模块声明**替代；其他结构一致。

### 3.1 许可证或版权（如有）

若文件需包含许可证或版权声明，应放在此处。

### 3.2 `package` 声明

`package` 声明**不换行**；**列宽限制**（见 §4.4）**不适用**。

### 3.3 导入（Imports）

#### 3.3.1 禁止通配符导入

无论静态与否，**不使用**通配符（on‑demand）导入。

#### 3.3.2 导入不换行

`import` 语句**不换行**；**列宽限制**（§4.4）**不适用**。

#### 3.3.3 排序与空行

导入分两组：  
1) **所有静态导入**为一组；  
2) **所有非静态导入**为一组。

若两组都存在，它们之间以**单个空行**分隔；**组内不额外空行**。组内按**ASCII 排序**导入的**名称**（注意：不是整行，因为 `.` 在 `;` 之前排序）。

#### 3.3.4 静态嵌套类不使用静态导入

**静态嵌套类**使用普通导入，而非 `static import`。

### 3.4 类声明（Class declaration）

#### 3.4.1 顶层类唯一

每个**顶层类**独占一个源文件。

#### 3.4.2 成员的组织顺序

类中**成员与初始化块**的顺序会显著影响**可学习性**。不存在放之四海而皆准的“正确食谱”，不同类可以采用不同的**有逻辑的顺序**，且维护者**应能解释**其原则。不要**按时间顺序**把新方法永远加在文件末尾。

##### 3.4.2.1 重载不拆分

同名方法（或构造器）应**连续成组**出现，不被其他成员打断；即使其修饰符（如 `static`、`private`）不同也如此。

### 3.5 模块声明（Module declaration）

#### 3.5.1 模块指令的排序与空行

模块指令分块并按以下顺序：
1) 所有 `requires`；  
2) 所有 `exports`；  
3) 所有 `opens`；  
4) 所有 `uses`；  
5) 所有 `provides`。  

各块之间以**单个空行**分隔。

---

## 4. 格式（Formatting）

> **术语**：*块状结构*（block‑like construct）指类/方法/构造器/`switch` 的**主体**。根据 §4.8.3.1，**数组初始化器**在需要时也可按“块状结构”处理。

### 4.1 花括号（Braces）

#### 4.1.1 可选花括号：一律使用

`if`、`else`、`for`、`do`、`while` 的**主体**即使为空或仅一条语句，也**必须使用花括号**。

（其他可选花括号，如 **lambda** 中的，可继续按语言规则**可选**。）

#### 4.1.2 非空块：K&R 风格

非空块及“块状结构”采用 **Kernighan & Ritchie（K&R）** 风格：
- **左括号前不换行**（个别处有例外）；
- 左括号**后**换行；
- 右括号**前**换行；
- 右括号**后**换行，仅当此括号**结束**了一条语句或**结束**方法/构造器/具名类的主体（若后接 `else` 或逗号，则**不**换行）。

**例外**：在允许出现“以分号结束的单语句”的位置，也可改用**语句块**；此时该块的**左括号前**应**换行**——这常用于**限制局部变量作用域**。

**示例**（省略）：见原文对应示例。

> enum 的部分例外见 §4.8.1。

#### 4.1.3 空块：可简写

空的块/块状结构可沿用 K&R，也可使用**紧凑写法**`{}`（中间无任何字符与换行）；但**多块语句**（如 `if/else`、`try/catch/finally`）**不得**使用紧凑空块。

### 4.2 块缩进：+2 空格

每当开启一个新块或“块状结构”，缩进**增加 2 个空格**；结束时**回退**到上一级。块内**代码与注释**均遵循该缩进。

### 4.3 一行一条语句

每条语句后**换行**。

### 4.4 列宽限制：100

Java 源码**列宽上限为 100** 个**Unicode 码位**。超出必须按 §4.5 **换行**。

- 每个 Unicode 码位按**1 个字符**计；如使用**全角字符**，可**提前**换行以改善显示。

**例外**：  
1) 无法遵守列宽的行（如 Javadoc 中的长 URL）；  
2) `package` 与 `import`（见 §3.2、§3.3）；  
3) **text block** 的内容；  
4) 注释中为复制到 shell 的**命令行**；  
5) 极少数需要的**异常长标识符**：此时周边代码的折行以 **google‑java‑format** 的输出为准。

### 4.5 折行（Line‑wrapping）

当需折行时，遵循以下大原则（简述）：
- 折行位置尽量出现在**高层级语法边界**（如逗号后、运算符前等）；
- 延续行应**+4 空格**或与**括号对齐**，保持整体整洁；
- 方法链可在 `.` 前换行；
- 表达式、参数列表、泛型、lambda 等按可读性调整。

> 实际项目建议交由 **google‑java‑format** 工具统一处理。

### 4.6 空白（Whitespace）

#### 4.6.1 垂直空白（Vertical）

需要空行的典型场景：
- **方法之间**；
- **字段组之间**（按语义分组）；
- **类内逻辑段落**之间；
- 依据文档其他章节（如 §3 源文件结构、§3.3 Imports）要求。

#### 4.6.2 水平空白（Horizontal）

除语言或规则要求外，以及字面量/注释/Javadoc 中的空格外，**单个 ASCII 空格**仅出现在（节选）：
- 关键字与左括号之间：`if (`、`for (`、`catch (`；
- 二元/三元运算符两侧；
- 逗号后、分号后、冒号后（非 label）；
- 类型与变量名之间；
- `//` 前至少 1 个空格；
- `@` 注解与其目标之间**不**加空格：`@Override`；
- 方法名与其参数左括号之间**不**加空格：`foo(bar)`。

（完整细则从略，推荐交由格式化工具执行）

### 4.7 特定结构（Specific constructs）

#### 4.7.1 数组初始化器可按“块”处理

多行数组初始化器可按“块状结构”缩进与换行。

### 4.8 语法元素细则（Language-specific formatting）

#### 4.8.1 `enum`

与常规 K&R 规则有少量例外（详见原文）。

#### 4.8.2 变量声明

##### 4.8.2.1 每个声明只声明一个变量

`int a, b;` 这类写法**不使用**。  
**例外**：`for` 头部允许多个变量。

#### 4.8.3 `switch`（语句与表达式）

Java 现有两种 `switch` 语法：**新式**（label 后 `->`）与**旧式**（label 后 `:`）。
- **缩进**：`switch` 块内容整体 **+2**；每个 `case/default` **同样 +2** 起始。  
- **穷尽性**：无论语言是否强制，Google 风格要求 **每个 `switch` 必须穷尽**（例如 `enum` 要覆盖所有枚举值，或使用 `default`）。
- **旧式落空**：旧式 `switch` 中，若**继续落入**下一分支，需以注释标明（如 `// fall through`）。最后一组语句不要求此注释。

（其余示例与细节见原文）

#### 4.8.5 注解（Annotations）

- **类/接口/枚举/record/包/模块**上的注解：紧随文档块之后；**每个注解独占一行**。包与模块示例：
  ```java
  /** This is a package. */
  @Deprecated
  @CheckReturnValue
  package com.example.frozzler;
  
  /** This is a module. */
  @Deprecated
  @SuppressWarnings("CheckReturnValue")
  module com.example.frozzler { ... }
  ```
- **方法/构造器**：与上一条相同；**例外**：**单个**且**无参数**的注解可与签名首行并列：`@Override public int hashCode() { ... }`
- **字段**：可将多个注解（含参数）**同一行**列出：`@Partial @Mock DataLoader loader;`
- **参数/局部变量**：无强制排版规则（类型使用处注解除外）。

#### 4.8.6 实现注释（Comments）

- 任意换行之前都可接实现注释；该行即视为**非空**。

##### 4.8.6.1 块注释风格

块注释与周围代码处于**同一缩进**；可用 `/* ... */` 或 `// ...`。多行 `/* ... */` 的后续行以 `*` 对齐：
```java
/*
 * This is          // And so           /* Or you can
 * okay.            // is this.          * even do this. */
 */
```
不使用由星号等字符“画框”的注释。

> **提示**：希望自动格式化器在需要时**重新换行段落**，优先使用 `/* ... */`；多数格式化器不会重排 `// ...` 样式的多行注释。

##### 4.8.6.2 `TODO` 注释

用于**临时**、**短期**、或**“够用但不完美”**的代码。格式：
```
TODO: <链接（最好是缺陷跟踪）> - <简要说明>
```
示例：
```java
// TODO: crbug.com/12345678 - Remove this after the 2047q4 compatibility window expires.
```
避免将个人或团队作为“上下文”的 `TODO`：
```java
// TODO: @yourusername - File an issue and use a '*' for repetition.
```
若是“某个时间点再做某事”，请给出**具体日期**或**具体事件**。

#### 4.8.7 修饰符顺序（Modifiers）

类与成员的修饰符，按 **JLS** 推荐顺序：
```
public protected private abstract default static final sealed non-sealed
  transient volatile synchronized native strictfp
```
`requires` 模块指令的修饰符顺序：`transitive static`。

#### 4.8.8 数字字面量（Numeric Literals）

`long` 型字面量使用**大写**后缀 `L`，避免与数字 `1` 混淆：`3000000000L`（**不要** `3000000000l`）。

#### 4.8.9 文本块（Text Blocks）

- 起始 `"""` **单独一行**；该行可按通常缩进，也可**无缩进**（顶格）；
- 结束 `"""` 与起始 **同缩进**，并可在其后同一行继续书写代码；
- 文本块中每行的缩进**不小于**开始/结束 `"""` 的缩进；更深的缩进将成为字符串前导空格；
- 文本块内容**可超出列宽限制**。

---

## 5. 命名（Naming）

### 5.1 通用规则

标识符仅使用 **ASCII 字母与数字**（极个别处允许下划线）。因此合法标识符可被正则 `\w+` 匹配。

Google 风格**不使用**特殊前/后缀：`name_`、`mName`、`s_name`、`kName` **都不是** Google 风格。

### 5.2 各类标识符

#### 5.2.1 包与模块名

仅使用**小写字母与数字**（**不**含下划线）；多词**直接拼接**：`com.example.deepspace`（而非 `deepSpace` 或 `deep_space`）。

#### 5.2.2 类名

使用 **UpperCamelCase**。通常为**名词/名词短语**（如 `Character`、`ImmutableList`）。接口名也多为名词/名词短语（如 `List`），有时可用**形容词/形容词短语**（如 `Readable`）。

测试类名以 `Test` 结尾，如 `HashIntegrationTest`；如果仅覆盖单一类，则以该类名 + `Test`，如 `HashImplTest`。

#### 5.2.3 方法名

使用 **lowerCamelCase**。通常为**动词/动词短语**（如 `sendMessage`、`stop`）。

JUnit 测试方法名中**可以**用下划线划分逻辑片段，每段采用 **lowerCamelCase**，如 `transferMoney_deductsFromSource`（并不存在唯一标准命名）。

#### 5.2.4 常量名（`static final` 且深度不可变）

使用 **`UPPER_SNAKE_CASE`**（全大写 + 下划线分词）。**常量**定义：`static final` 字段，其**内容深度不可变**且其方法**无可观察副作用**。例如：**原始类型**、**字符串**、**不可变值类**、或被设为 `null` 的任何引用。若实例的任何可观察状态可能改变，**就不是常量**；仅仅“承诺不修改对象”**不算**。

```java
// 常量
static final int NUMBER = 5;
static final ImmutableList<String> NAMES = ImmutableList.of("Ed", "Ann");
static final Map<String, Integer> AGES = ImmutableMap.of("Ed", 35, "Ann", 32);
static final Joiner COMMA_JOINER = Joiner.on(','); // Joiner 不可变
static final SomeMutableType[] EMPTY_ARRAY = {};

// 不是常量
static String nonFinal = "non-final";
final String nonStatic = "non-static";
static final Set<String> mutableCollection = new HashSet<String>();
static final ImmutableSet<SomeMutableType> mutableElements = ImmutableSet.of(mutable);
static final ImmutableMap<String, SomeMutableType> mutableValues =
    ImmutableMap.of("Ed", mutableInstance, "Ann", mutableInstance2);
static final Logger logger = Logger.getLogger(MyClass.getName());
static final String[] nonEmptyArray = {"these", "can", "change"};
```

#### 5.2.5 非常量字段名

（含静态与实例）使用 **lowerCamelCase**，通常为**名词/名词短语**（如 `computedValues`、`index`）。

#### 5.2.6 参数名

使用 **lowerCamelCase**。**公开方法**中应**避免**单字符参数名。

#### 5.2.7 局部变量名

使用 **lowerCamelCase**。即便被 `final` 修饰且不可变，**局部变量也不视为常量**，不应按常量风格命名。

#### 5.2.8 类型变量名

二选一：
- **单个大写字母**，可选跟一个数字（如 `E`、`T`、`X`、`T2`）；
- 按**类名风格** + `T`（如 `RequestT`、`FooBarT`）。

### 5.3 驼峰命名的定义（Camel case: defined）

当存在多种看似合理的驼峰转换方式（如含缩写、`IPv6`、`iOS` 等），为提升**可预测性**，采纳如下近似**确定性**方案：
1) 将短语转换为**纯 ASCII**，去掉撇号（如 `Müller's algorithm` → `Muellers algorithm`）；  
2) 按空格与剩余标点（常为连字符）**分词**；  
   - **推荐**：若某词在常用写法中已呈“驼峰形态”（如 AdWords），可**拆分**为基本词（`ad` `words`）。`iOS` 非典型驼峰，不适用该建议；  
3) 将全部词**小写**（含缩写），并只将：  
   - **每个词**首字母大写 → **UpperCamelCase**；或  
   - **除第一个词以外**每个词首字母大写 → **lowerCamelCase**；  
4) 将各词**拼接**为一个标识符。原词的大小写基本**忽略**。

极少数场景（如**多段版本号**）可用下划线分隔**相邻数字**。

**示例（正确/错误）**：
- “XML HTTP request” → `XmlHttpRequest` / `XMLHTTPRequest`  
- “new customer ID” → `newCustomerId` / `newCustomerID`  
- “inner stopwatch” → `innerStopwatch` / `innerStopWatch`  
- “supports IPv6 on iOS?” → `supportsIpv6OnIos` / `supportsIPv6OnIOS`  
- “YouTube importer” → `YouTubeImporter` / `YoutubeImporter`（可接受但不推荐）  
- “Turn on 2SV” → `turnOn2sv` / `turnOn2Sv`  
- “Guava 33.4.6” → `guava33_4_6` / `guava3346`  

> 备注：英文中一些**连字符**用法有歧义（如 *nonempty* vs *non‑empty*），因此 `checkNonempty` 与 `checkNonEmpty` 都可接受。

---

## 6. 编程实践（Programming Practices）

### 6.1 **@Override**：凡合法处一律使用

凡是**合法**的地方都应加 `@Override`，包括：
- 覆写超类方法的**类方法**；
- 实现接口方法的**类方法**；
- 在子接口中**重申**上级接口方法的**接口方法**；
- **record 组件**的显式访问器。

**例外**：当父方法标注 `@Deprecated` 时，**可省略**。

### 6.2 捕获的异常：不应被忽略

几乎没有**什么都不做**的 `catch` 是正确的做法（通常至少**记录日志**，或若认为“不可能发生”，则抛为 `AssertionError`）。  
确实需要**不做任何处理**时，**必须写注释**解释其合理性。

```java
try {
  int i = Integer.parseInt(response);
  return handleNumericResponse(i);
} catch (NumberFormatException ok) {
  // it's not numeric; that's fine, just continue
}
return handleTextResponse(response);
```

### 6.3 静态成员：用类名限定

当必须限定引用**静态成员**时，使用**类名**限定，而不是实例或返回该类型的表达式：
```java
Foo aFoo = ...;
Foo.aStaticMethod();           // good
aFoo.aStaticMethod();          // bad
somethingThatYieldsAFoo().aStaticMethod(); // very bad
```

### 6.4 终结器（finalize）：不要使用

不要覆写 `Object.finalize`。JVM 的**终结**机制**计划移除**。

---

## 7. Javadoc

### 7.1 排版（Formatting）

#### 7.1.1 基本形式
```java
/**
 * Multiple lines of Javadoc text are written here,
 * wrapped normally...
 */
public int method(String p1) { ... }
```

**单行**形式：
```java
/** An especially short bit of Javadoc. */
```
基本形式总是可用。若整个 Javadoc（含注释标记）**可放在一行**且**没有 block 标签**（如 `@param`），可用单行形式。

#### 7.1.2 段落（Paragraphs）

段落之间，以及段落与 **block 标签组**之间，有**一行仅含对齐星号 `*` 的空行**。除第一段外，每段在首词**前立即写 `<p>`**（其后**不**加空格）。`<ul>`、`<table>` 等**块级 HTML**标签前**不**写 `<p>`。

#### 7.1.3 块级标签（Block tags）

使用的标准块级标签按以下顺序出现：`@param`、`@return`、`@throws`、`@deprecated`。这四类**不得**空描述。若标签一行放不下，续行相对于 `@` **缩进 ≥ 4 空格**。

> **提示**：常见错误 `/** @return the customer ID */` 应改为  
> `/** Returns the customer ID. */` 或 `/** {@return the customer ID} */`。

### 7.2 摘要片段（The summary fragment）

每个 Javadoc 以**简短摘要片段**开头——这是在类/方法索引等场景**唯一可见**的部分。该片段是**名词或动词短语**，不是完整句子；不要以 `A {@code Foo} is ...`、`This method returns ...` 开头，也不写成祈使句 `Save the record.`。但其**首字母大写，句末标点**按完整句子处理。

### 7.3 何处需要 Javadoc（Where Javadoc is used）

至少以下**可见**元素需要 Javadoc：
- **顶层可见类**：即 `public`；
- **可见成员**：其**所属类可见**且成员为 `public` 或 `protected`；
- **可见的 record 组件**：其 record 可见。

此外，可按 §7.3.4 的说明**补充** Javadoc。

#### 7.3.1 例外：自解释成员

对于“**简单且不言自明**”的成员/record 组件（如 `getFoo()`），如果确实**没有其他值得说明的信息**，Javadoc 可省略。  
> **重要**：不要借口“自解释”而**省略用户需要的背景**。例如 `canonicalName`，若读者可能不知道“规范名”之意，就不应省略其说明。

#### 7.3.2 例外：覆写

覆写超类型方法时，方法上**不一定**需要 Javadoc。

#### 7.3.4 非强制 Javadoc（Non‑required）

其他类/成员/record 组件**视需要**添加 Javadoc。凡是你会用“实现注释”来**说明整体目的或行为**的地方，应改为使用 **Javadoc**（`/**`）。  
非强制 Javadoc **不必**严格遵循 §7.1.1/7.1.2/7.1.3/7.2 的格式（当然**推荐**遵循）。

---

## 附录：工具与参考

- **google-java-format**：Google 官方格式化工具，确保输出符合本指南（含换行/列宽等）  
  - GitHub：`google/google-java-format`
- **JLS**：Java 语言规范（修饰符顺序等以其为准）

---

## 版权与许可

- 原文与本译文遵循 **Creative Commons Attribution 3.0（CC BY 3.0）**。转载、改编与商业使用需**保留署名与原链接**。  
- 原文地址：`https://google.github.io/styleguide/javaguide.html`  
- 许可证详情：`https://creativecommons.org/licenses/by/3.0/`

