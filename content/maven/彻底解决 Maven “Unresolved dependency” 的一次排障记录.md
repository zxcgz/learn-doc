
> 关键词：Maven 依赖解析失败、Gradle 拉包失败、`~/.m2/settings.xml`、镜像/代理、TLS/CA、Nexus/Artifactory、离线构建、缓存损坏

本文整理自一次真实排障：一个原本**一直能正常构建**的 Java 项目，突然在打包时出现大量 **Unresolved dependency**（依赖无法解析）错误，例如：

```
Unresolved dependency: 'commons-codec:commons-codec:jar:1.10'
Unresolved dependency: 'junit:junit:jar:4.11'
Unresolved dependency: 'org.apache.commons:commons-lang3:jar:3.17.0'
Unresolved dependency: 'ch.qos.logback:logback-classic:jar:1.2.10'
Unresolved dependency: 'com.alibaba:fastjson:jar:1.2.4'
Unresolved dependency: 'org.apache.httpcomponents:httpclient:jar:4.5.2'
Unresolved dependency: 'org.jline:jline:jar:3.21.0'
Unresolved dependency: 'org.apache.commons:commons-configuration2:jar:2.10.1'
```

这些坐标都在 **Maven Central** 能找到；所以出现该类错误，**99% 是仓库配置/网络/证书/缓存的问题**，而不是“仓库里没有”。

---

## 一、问题本质

> **构建工具（Maven/Gradle）没法从任何可用仓库下载依赖**。  
> 典型的根因：镜像拦截、仓库不可达、网络代理/证书问题、本地缓存损坏、关闭了在线模式、公司内网 Nexus 配置异常等。

---

## 二、快速自检清单（按影响面从高到低）

1. **仓库源/镜像拦截异常**
    
    - 你是否在 `~/.m2/settings.xml` 用 `<mirrorOf>*</mirrorOf>` 指向了某个镜像？镜像挂了就“全挂”。
        
    - **建议**：不要用 `*`，优先直连 **Maven Central**，镜像只当“补充”。
        
2. **网络/代理**
    
    - 主机能否直连外网？是否必须走 HTTP/HTTPS 代理？代理凭据是否过期？
        
    - 直接测试：
        
        ```bash
        curl -I https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar
        ```
        
3. **JDK TLS/根证书（CA）过旧**
    
    - 老旧 JDK 的 `cacerts` 可能无法正确校验证书链（尤其是 Let’s Encrypt/ISRG Root 更新之后）。
        
    - **建议**：JDK ≥ 8u252 或 11+，必要时升级/更新证书库。
        
4. **本地缓存损坏**
    
    - 下载中断或磁盘问题导致 `.m2`/`.gradle` 中的工件损坏，之后便一直失败。
        
    - **建议**：清理指定坐标或全量清理后重拉。
        
5. **仓库列表缺失或“只用镜像”导致的新版本不可得**
    
    - 比如只配置了国内镜像，而镜像尚未同步某些版本。
        
    - **建议**：**一定保留 `mavenCentral()`**。
        
6. **离线构建被误打开**
    
    - Gradle/IDE 勾选了 Offline，或 Maven 用了 `-o`，但本地没有缓存。
        
7. **公司 Nexus/Artifactory 代理异常**
    
    - 远程仓库 URL、SSL、拉取策略、容量配额、索引、访问控制等异常都会“全挂”。
        

---

## 三、没有 `~/.m2/settings.xml` 怎么办？

没问题——**默认没有该文件是正常的**。遇到解析失败时，反而建议**新建**一个最小可用的 `settings.xml`，显式启用 Central 并避免“镜像拦截全部”。

### 3.1 创建 `~/.m2/settings.xml`

**Linux/macOS**

```bash
mkdir -p ~/.m2
nano ~/.m2/settings.xml
```

**Windows**  
在 `%USERPROFILE%\.m2\` 新建 `settings.xml`（如 `C:\Users\<你>\.m2\settings.xml`）。

**推荐模板（稳妥直连 Central，可选增加备用镜像/代理）：**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">

  <!-- 如必须走代理，解除注释并按需填写 -->
  <!--
  <proxies>
    <proxy>
      <id>corp</id>
      <active>true</active>
      <protocol>https</protocol>
      <host>proxy.example.com</host>
      <port>3128</port>
      <username>user</username>
      <password>pass</password>
      <nonProxyHosts>localhost|127.0.0.1|*.intranet</nonProxyHosts>
    </proxy>
  </proxies>
  -->

  <profiles>
    <profile>
      <id>use-central</id>
      <repositories>
        <repository>
          <id>central</id>
          <url>https://repo1.maven.org/maven2/</url>
          <releases><enabled>true</enabled></releases>
          <snapshots><enabled>false</enabled></snapshots>
        </repository>

        <!-- 可选：国内备用源，仅作补充，避免拦截一切 -->
        <!--
        <repository>
          <id>aliyun</id>
          <url>https://maven.aliyun.com/repository/public</url>
          <releases><enabled>true</enabled></releases>
          <snapshots><enabled>true</enabled></snapshots>
        </repository>
        -->
      </repositories>

      <pluginRepositories>
        <pluginRepository>
          <id>central</id>
          <url>https://repo1.maven.org/maven2/</url>
        </pluginRepository>
      </pluginRepositories>
    </profile>
  </profiles>

  <activeProfiles>
    <activeProfile>use-central</activeProfile>
  </activeProfiles>
</settings>
```

> ⚠️ **不要**把 `<mirrorOf>*</mirrorOf>` 指向单一镜像，否则它会劫持所有仓库（包括插件仓库）；一旦镜像挂了，构建全部失败。

### 3.2 项目级生效（不影响全局）

在项目根目录新建 `.mvn/settings.xml`（路径名固定为 `.mvn` 目录），内容同上。这样仅对当前项目生效。

---

## 四、从零恢复：最小可行步骤

### 4.1 Maven 项目

1. **检查 JDK/Maven 版本**
    
    ```bash
    mvn -version
    ```
    
2. **查看有效配置（确认仓库/代理确实生效）**
    
    ```bash
    mvn help:effective-settings
    ```
    
3. **强制更新依赖并打包（打开调试）**
    
    ```bash
    mvn -U -e -X -DskipTests package
    ```
    
4. **若仍失败：清理本地损坏缓存后重拉**
    
    ```bash
    mvn dependency:purge-local-repository -DreResolve=true
    ```
    
    或手动清理某些坐标：
    
    ```bash
    rm -rf ~/.m2/repository/commons-codec/commons-codec/1.10
    rm -rf ~/.m2/repository/junit/junit/4.11
    # ...按需删除
    ```
    
5. **网络直连测试（排除网络层问题）**
    
    ```bash
    curl -I https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar
    ```
    
6. **TLS/证书问题定位（如怀疑 SSL）**
    
    ```bash
    mvn -Dhttps.protocols=TLSv1.2 -Djavax.net.debug=ssl:handshake -U -e -X -DskipTests package
    ```
    
    如出现证书链错误：升级 JDK 或更新 `cacerts`。
    

### 4.2 Gradle 项目

1. **保证仓库列表包含 Central**
    
    ```groovy
    // build.gradle
    repositories {
        mavenLocal()
        mavenCentral()
        // 可选：国内备用
        // maven { url 'https://maven.aliyun.com/repository/public' }
    }
    ```
    
2. **刷新依赖**
    
    ```bash
    ./gradlew --no-daemon build --refresh-dependencies
    ```
    
3. **检查是否误开离线模式（IDE 或 --offline）**  
    若开了离线，且本地无缓存，必然失败。
    

---

## 五、公司内网 Nexus/Artifactory 的专项检查

若公司要求统一走内网仓库代理，请 **只镜像 `central`**，不要 `*`。并在管理端检查：

- **Remote URL**：应为 `https://repo1.maven.org/maven2`
    
- **SSL/证书**：远端可达且证书通过
    
- **Releases/Snapshots 策略**：按需启用
    
- **配额/存储**：空间是否耗尽
    
- **索引/缓存**：必要时重建索引、清空远端缓存
    
- **“Remote storage reachable”** 状态：必须是可达
    

---

## 六、常见坑与最佳实践

- ✅ **始终保留 Maven Central**；镜像只做补充，不做拦截。
    
- ✅ 为降低偶发网络问题，**优先拉取到本地缓存**（CI 可配置缓存目录）。
    
- ✅ **避免开启离线构建**，除非你非常确定缓存齐全。
    
- ✅ 使用 **`mvn help:effective-settings`** 快速确认“到底用了哪个仓库/代理/镜像”。
    
- ✅ 遇到 SSL 相关错误，优先检查 **JDK 版本与 CA 证书**。
    
- ✅ 定位下载失败时，抓取第一条  
    `Could not transfer artifact ... from/to <repoId> (<URL>)`  
    ——这行信息最关键。
    

---

## 七、最终排障总结（可作复盘清单）

1. **创建或修正 `~/.m2/settings.xml`**：启用 Central，避免镜像拦截一切。
    
2. **验证网络直连**：`curl -I` 测试 Central 可达。
    
3. **升级/校验 JDK TLS/CA**：确保 TLS1.2 与证书链正常。
    
4. **清理损坏缓存**：`dependency:purge-local-repository` 或手动删坐标目录。
    
5. **Gradle 保留 `mavenCentral()`**，并 `--refresh-dependencies`。
    
6. **核查离线模式**：关闭 Offline。
    
7. **如走内网 Nexus**：检查远端配置、证书、策略、配额与索引。
    

按以上步骤，类似 `commons-codec:1.10`、`junit:4.11`、`commons-lang3:3.17.0`、`logback-classic:1.2.10`、`fastjson:1.2.4`、`httpclient:4.5.2`、`jline:3.21.0`、`commons-configuration2:2.10.1` 等常见依赖应能**全部恢复解析**。

---

## 八、附录：一键排查命令集合

```bash
# 查看版本（确认别太旧）
mvn -version

# 打印生效的 settings（确认仓库/代理/镜像到底用了谁）
mvn help:effective-settings

# 强制更新 + 调试日志（定位第一条失败的仓库/URL）
mvn -U -e -X -DskipTests package

# 清理本地依赖缓存并重新解析
mvn dependency:purge-local-repository -DreResolve=true

# 指定坐标手动清缓存（示例）
rm -rf ~/.m2/repository/org/apache/commons/commons-lang3/3.17.0

# 直连 Central 可达性测试
curl -I https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar

# SSL/TLS 握手调试（如怀疑证书问题）
mvn -Dhttps.protocols=TLSv1.2 -Djavax.net.debug=ssl:handshake -U -e -X -DskipTests package
```

**Gradle：**

```bash
# 刷新依赖
./gradlew --no-daemon build --refresh-dependencies
```

---

**结语**  
“Unresolved dependency” 多半不是依赖本身的问题，而是**仓库与网络链路**的问题。把仓库配置、网络/代理、TLS/证书、本地缓存、离线模式、私服代理这几件事检查清楚，问题基本就迎刃而解。希望这份排障记录能帮你快速恢复构建。