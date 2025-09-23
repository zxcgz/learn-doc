---
title: Spring Boot fat‑jar 启动报错：nested jar 必须无压缩（Store）——原理、定位与 7‑Zip 无重打包修复
date: 2025-09-23
keywords: [Spring Boot, fat jar, nested jar, BOOT-INF/lib, Store, 7-Zip, bootJar, repackage]
---

## TL;DR

- 报错核心：
  
  ```text
  Unable to open nested entry 'BOOT-INF/lib/xxx.jar'. It has been compressed and nested jar files must be stored without compression.
  ```
  
  Spring Boot 启动器要求 **嵌套依赖 JAR 必须为不压缩（Store）条目**。若被压缩（Deflate），就无法随机访问，从而启动失败。

- **标准修复**：使用官方打包方式重新产物：
  - Maven：`spring-boot-maven-plugin` 的 `repackage`
  - Gradle：`bootJar`（禁用普通 `jar` 产物）

- **不重打包的就地修补**（无需源码构建）：
  - 用 7‑Zip/`jar`/`zip` 将问题条目以 **Store（-mx=0）** 的方式覆盖回去即可；或解包目录 **exploded 运行**；或在**原包能正常启动**时用 `PropertiesLauncher` 挂载外部依赖覆盖。

---

## 一、问题成因与常见触发

- 成因：`app.jar` 内的 `BOOT-INF/lib/*.jar` 被 **压缩（Deflated）** 存储。
- 常见触发：
  - 使用 `maven-assembly-plugin`（`jar-with-dependencies`）或手工 `zip/jar` 二次打包。
  - CI/CD 流水线里解包后又用默认压缩方式重打包。
  - 使用 Gradle 的普通 `jar`/`shadowJar` 代替 `bootJar` 运行。

> [!warning] 结论
> Spring Boot 的可执行 JAR 要求 `BOOT-INF/lib` 下的嵌套依赖是 **Stored（不压缩）**。一旦压缩，必崩。

---

## 二、如何定位与验证

### 1) 查看某个依赖是否被压缩

```bash
# 查看单个条目（Linux/macOS）
unzip -lv app.jar | grep 'BOOT-INF/lib/hutool-all-5.1.2.jar'

# 批量查看依赖条目（第 2 列如出现 Defl: 表示被压缩）
unzip -lv app.jar | awk '/BOOT-INF\/lib\//{print $8, $6}' | head
```

或用 7‑Zip：
```bash
7z l -slt app.jar | sed -n '/^Path = BOOT-INF\/lib\/hutool-all-5.1.2.jar$/,/^$/p' | grep '^Method'
# 期望：Method = Store
```

> [!tip] 观察点
> 看到 `Store` 即为正确；`Deflate`/`Defl` 表示错误。

---

## 三、标准修复（推荐）

### Maven
```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-maven-plugin</artifactId>
      <executions>
        <execution>
          <goals>
            <goal>repackage</goal>
          </goals>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

```bash
mvn clean package -DskipTests
java -jar target/your-app.jar
```

### Gradle（Groovy DSL）
```groovy
plugins {
  id 'org.springframework.boot' version '3.3.0'
  id 'io.spring.dependency-management' version '1.1.5'
  id 'java'
}

bootJar { enabled = true }
jar { enabled = false }
```

```bash
./gradlew clean bootJar
java -jar build/libs/your-app.jar
```

> [!note] 关于 shade/重定位
> 如必须类名重定位，请优先通过依赖排除/版本统一规避冲突；确需 Shade，也应由 `bootJar` 产出符合 Boot 布局的产物，避免再二次压缩。

---

## 四、无源码情况下的就地修补方案（不重打包）

### 方案 A：直接在 fat‑jar 内替换依赖（保持 Store）

#### 使用 7‑Zip（命令行）
```bash
# 0) 备份
cp app.jar app.jar.bak

# 1) 准备同路径文件
mkdir -p BOOT-INF/lib
cp /path/to/new/hutool-all-5.8.26.jar BOOT-INF/lib/hutool-all-5.1.2.jar

# 2) 删除旧条目
7z d app.jar BOOT-INF/lib/hutool-all-5.1.2.jar

# 3) 以不压缩方式添加新条目（-mx=0 = Store）
7z a -tzip -mx=0 app.jar BOOT-INF/lib/hutool-all-5.1.2.jar

# 4) 验证为 Store
7z l -slt app.jar | sed -n '/^Path = BOOT-INF\/lib\/hutool-all-5.1.2.jar$/,/^$/p' | grep '^Method'
```

#### 使用 7‑Zip（GUI）
1. 用 7‑Zip 打开 `app.jar` → 进入 `BOOT-INF/lib/`
2. 将新 JAR 拖入窗口，**Compression level 选择 Store**，确认覆盖。
3. 在属性/列表中确认 `Method = Store`。

#### 使用 `jar`/`zip`（可选）
```bash
# jar 工具（0 是数字零，表示无压缩）
cp app.jar app.jar.bak
mkdir -p tmp/BOOT-INF/lib
cp /path/to/new.jar tmp/BOOT-INF/lib/hutool-all-5.1.2.jar
(cd tmp && "$JAVA_HOME/bin/jar" uf0 ../app.jar BOOT-INF/lib/hutool-all-5.1.2.jar)

# 或 zip 两步法：先常规压缩，再对 BOOT-INF/lib 覆盖为 Store
zip -r9 app-fixed.jar .            # 若在解包目录内
zip -0 -r app-fixed.jar BOOT-INF/lib/
```

> [!warning] 注意
> - 如果 fat‑jar 被 `jarsigner` 签名，任何修改都会破坏签名（一般业务 fat‑jar 不签）。
> - 替换不同版本库要关注 API 兼容性。

### 方案 B：解包目录（exploded）运行

```bash
mkdir app_exploded && cd app_exploded
jar xf ../app.jar
cp /path/to/new/hutool-all-5.8.26.jar BOOT-INF/lib/hutool-all-5.1.2.jar

# 从目录运行（读取 Start-Class）
java -cp . org.springframework.boot.loader.JarLauncher
```

优点：无需再“写回 zip”，修改/回滚都很快；不受“嵌套条目必须 Store”的限制。

### 方案 C：外挂覆盖（原包能启动时）

```bash
# 将新依赖放到 /opt/patches/
java -Dloader.path=/opt/patches/ -cp app.jar org.springframework.boot.loader.PropertiesLauncher
```

> [!important] 限制
> 如果当前**因被压缩条目而无法启动**，此方案无效——构建 classpath 时仍会读取归档内每个 `BOOT-INF/lib/*.jar`，遇到压缩条目照样报错。

---

## 五、排错清单（Checklist）

- [ ] `unzip -lv` / `7z l -slt` 确认问题依赖是否为 **Store**。
- [ ] 使用 `spring-boot-maven-plugin:repackage` 或 `bootJar` 产物作为最终可执行包。
- [ ] CI/CD 禁止解包后用默认压缩再打回包。
- [ ] 若进行就地修补：**7‑Zip 添加时一定用 `-mx=0`**。
- [ ] 必要时用 `java -Xlog:class+load=info`（JDK 17+）确认类加载来源是否为新依赖。
- [ ] 保留 `app.jar.bak` 以便快速回滚。

---

## 六、常见 QA

**Q1：能否只换一个依赖而不重打包？**  
A：可以，按上文 7‑Zip 的“删除旧条目 + 以 Store 添加新条目”即可。

**Q2：外部挂载依赖能否绕过这个错误？**  
A：仅当原包能启动时可用。若因压缩条目导致启动即失败，仍需修复归档内条目为 Store。

**Q3：为什么 Boot 要求 Store？**  
A：Spring Boot Loader 需要对嵌套 JAR 做类路径随机访问；Deflate 压缩条目不支持所需的随机定位方式。

---

## 七、附：一键替换脚本（7‑Zip CLI）

> 将 `APP_JAR`、`OLD_PATH`、`NEW_JAR` 替换为你的实际路径。

### Bash（Linux/macOS）
```bash
#!/usr/bin/env bash
set -Eeuo pipefail
APP_JAR="app.jar"
OLD_PATH="BOOT-INF/lib/hutool-all-5.1.2.jar"
NEW_JAR="/path/to/hutool-all-5.8.26.jar"

cp "$APP_JAR" "$APP_JAR.bak"
mkdir -p BOOT-INF/lib
cp "$NEW_JAR" "$OLD_PATH"
7z d "$APP_JAR" "$OLD_PATH"
7z a -tzip -mx=0 "$APP_JAR" "$OLD_PATH"
7z l -slt "$APP_JAR" | sed -n "/^Path = ${OLD_PATH//\//\\/}$/,/^$/p" | grep '^Method'
```

### PowerShell（Windows）
```powershell
$AppJar = "app.jar"
$OldPath = "BOOT-INF/lib/hutool-all-5.1.2.jar"
$NewJar = "C:\\path\\hutool-all-5.8.26.jar"

Copy-Item $AppJar "$AppJar.bak"
New-Item -ItemType Directory -Force (Split-Path $OldPath) | Out-Null
Copy-Item $NewJar $OldPath
7z d $AppJar $OldPath
7z a -tzip -mx=0 $AppJar $OldPath
7z l -slt $AppJar | Select-String -Pattern "Path = $OldPath","^Method" -SimpleMatch
```

---

## 八、避坑要点（总结）

- **永远用官方插件产物**（`repackage` / `bootJar`）。
- **禁止** 用 `assembly`/手工 `zip` 生成可执行 fat‑jar。
- **7‑Zip 添加时务必 `-mx=0`（Store）**。
- 考虑回滚策略：随时保留 `.bak`。

> [!done] 至此，你可以：
> 1) 快速定位是否为压缩条目引起；
> 2) 在无源码条件下，用 7‑Zip 就地修补；
> 3) 从源头上用正确的构建任务产出合规可执行包。

