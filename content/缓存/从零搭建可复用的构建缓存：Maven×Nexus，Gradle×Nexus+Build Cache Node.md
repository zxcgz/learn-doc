
date: 2025-09-26  
tags: [build-cache, nexus, maven, gradle, bcn, ci, android, devops]

> 目标：**在现有 Maven/Gradle 项目上，以最低改造获得稳定的“远程构建缓存”**，开发机提速、CI 稳定复用、权限可控、易于运维。


# 背景与结论

- 我们的依赖解析统一走 **Nexus Repository OSS**。
    
- **Maven** 的远程构建缓存使用 **Apache Maven Build Cache Extension**，把缓存条目存到 **Nexus 的 Raw(hosted)** 仓库。
    
- **Gradle** 使用两种远端：
    
    1. **Build Cache Node（BCN）**：Gradle/（可选 Bazel）专用缓存服务；
        
    2. （备选）**Nexus Raw(hosted)**：当 BCN 不可用或做分环境时，Gradle 也能直接对接一个支持 HTTP GET/PUT 的端点。
        
- 权限策略：**开发只读（命中远端），CI 读写（“种子构建”产出条目）**。
    

---

# 为什么不能“一个缓存，两端共用”？

- Gradle/BCN 与 Maven Build Cache Extension 的**缓存协议/目录布局不同**。
    
- 因此**无法共用同一份缓存条目**；但可以“同一台机器、不同路径”统一运维（比如 `cache.example.com/gradle-cache/` 与 `.../maven-cache/`）。
    

---

# 方案对比与最终选型

## 方案 A：全部指向 Nexus Raw(hosted)

- **优点**：单一服务，学习/运维成本低。
    
- **缺点**：Gradle 只能用“最基础的 HTTP 远端”，没有 BCN 的专门优化与（可选）UI。
    

## 方案 B：**Gradle→BCN；Maven→Nexus**（**最终采用**）

- **优点**：Gradle 享受 BCN 的专长能力；Maven 使用官方开源扩展 + Nexus Raw(hosted)；两边“各用其长”。
    
- **缺点**：多一个服务需要维护（BCN），但可通过反代统一域名、分路径治理。
    

---

# 最终架构（Mermaid）

```mermaid
flowchart LR
    subgraph Dev&CI Clients
      A[Maven 项目] -->|HTTP GET/PUT| B[(Nexus Raw: build-cache/maven)]
      G[Gradle 项目] -->|HTTP(S)| C[(Build Cache Node :5071 /cache)]
      G -->|可选备用| B
    end

    subgraph Server
      B -- Raw(hosted) --> D[存储(磁盘/S3)]
      C -- BCN --> E[本地存储(磁盘)]
    end

    classDef s fill:#eef,stroke:#99f
    class B,C s
```

> 如需统一入口，可在 Nginx 把  
> `/maven-cache/` 反向到 Nexus Raw(hosted)，  
> `/gradle-cache/` 反向到 BCN。

---

# 部署与配置

## 1) Nexus：创建 Raw(hosted) 仓库

- 新建 **Raw(hosted)** 仓库：`build-cache`
    
- 可在其下用前缀目录区分客户端：
    
    - Maven：`/maven/`
        
    - Gradle：`/gradle/`
        
- **权限建议**
    
    - 开发：`browse/read`（只读远端）
        
    - CI：额外给 `add/edit`（可写入）
        
- 可用 **Cleanup Policy** 回收陈旧条目；生产环境不要开放“匿名写”。
    

### 快速自测匿名/权限（可选）

```bash
# 写入一份探针文件（期望 201/200）
curl -v -T ./probe.txt \
  http://<nexus>:8081/repository/build-cache/maven/probe.txt

# 读取（期望 200）
curl -I http://<nexus>:8081/repository/build-cache/maven/probe.txt
```

---

## 2) Maven：接入 Nexus 作为“nexus-build-cache”

> 以下文件**除 `~/.m2/settings.xml` 外**，都建议提交版本库。

**`.mvn/extensions.xml`**

```xml
<extensions>
  <extension>
    <groupId>org.apache.maven.extensions</groupId>
    <artifactId>maven-build-cache-extension</artifactId>
    <version>1.2.0</version>
  </extension>
</extensions>
```

**`.mvn/maven-build-cache-config.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<cache xmlns="http://maven.apache.org/BUILD-CACHE-CONFIG/1.0.0"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://maven.apache.org/BUILD-CACHE-CONFIG/1.0.0 https://maven.apache.org/xsd/build-cache-config-1.0.0.xsd">

  <configuration>
    <!-- 干净构建才允许写缓存（建议保持 true）-->
    <mandatoryClean>true</mandatoryClean>

    <!-- 远端：Nexus Raw(hosted)；本地默认只读，CI 再开启写入 -->
    <remote enabled="true"
            saveToRemote="false"
            transport="resolver"
            id="nexus-build-cache">
      <url>http://<nexus>:8081/repository/build-cache/maven/</url>
    </remote>
  </configuration>
</cache>
```

> **踩坑提示**：`saveToRemote` 是 `<remote>` 的**属性**，不是子标签；命名空间与 schema 请按上例。

**`~/.m2/settings.xml`（个人/CI 主机）**

```xml
<settings>
  <servers>
    <server>
      <id>nexus-build-cache</id>
      <username>${env.CACHE_USER}</username>
      <password>${env.CACHE_PASS}</password>
    </server>
  </servers>

  <!-- （可选）依赖解析统一镜像到 Nexus 组仓 -->
  <mirrors>
    <mirror>
      <id>nexus</id>
      <name>Company Nexus</name>
      <url>http://<nexus>:8081/repository/maven-public/</url>
      <mirrorOf>*</mirrorOf>
    </mirror>
  </mirrors>
</settings>
```

**本地只读（开发）**

```bash
mvn -Dmaven.build.cache.enabled=true \
    -Dmaven.build.cache.remote.enabled=true \
    clean package
```

**CI 写入（种子构建）**

```bash
mvn -B -U \
    -Dmaven.build.cache.enabled=true \
    -Dmaven.build.cache.remote.enabled=true \
    -Dmaven.build.cache.remote.save.enabled=true \
    -Dmaven.build.cache.mandatoryClean=true \
    clean verify
```

**验证**

- Nexus UI → _Browse_ → `build-cache` 仓库下出现新条目（不仅是 `build-cache-report.xml`）。
    
- 第二次相同输入构建时间明显降低（大量任务从缓存还原）。
    

---

## 3) Gradle：接入 BCN（主用）/ Nexus Raw（备选）

**`gradle.properties`**

```
org.gradle.caching=true
```

**`settings.gradle.kts`**

```kotlin
import org.gradle.caching.http.HttpBuildCache

buildCache {
  local {
    isEnabled = true
  }
  // ① 首选：BCN（http://<bcn-host>:5071/cache/）
  remote<HttpBuildCache>("bcn") {
    url = uri("http://<bcn-host>:5071/cache/")
    isAllowInsecureProtocol = true     // 仅 HTTP 时需要
    isPush = (System.getenv("CI") == "true")
  }

  // ② 备选：Nexus Raw(hosted)（必要时启用）
  // remote<HttpBuildCache>("nexus") {
  //   url = uri("http://<nexus>:8081/repository/build-cache/gradle/")
  //   isAllowInsecureProtocol = true
  //   isPush = (System.getenv("CI") == "true")
  // }
}
```

**确认命中/写入**

```bash
# 读取/命中细节
./gradlew assemble --info -Dorg.gradle.caching.debug=true
```

---

# 安全与运维

- **权限模型**：建议“开发只读 / CI 读写”。
    
- **匿名写入**：仅限内网调试，尽快回收；可在反向代理限制方法（只放 GET/HEAD/PUT）与来源网段。
    
- **清理策略**：Nexus 配置 Cleanup Policy，定期 **Compact Blob Store**；BCN 也需磁盘观测与轮转。
    
- **HTTPS**：生产强烈建议启用；若短期只能 HTTP，Gradle 端需 `isAllowInsecureProtocol=true`。
    
- **备份**：Nexus data 与 BCN 存储目录/卷定期备份；日志观察 `request.log` 的 PUT/GET 2xx。
    

---

# 常见问题排查

### 1. Maven 只看到 `build-cache-report.xml`

- 没开写入：在 CI 用 `-Dmaven.build.cache.remote.save.enabled=true`。
    
- 非干净构建：你配置了 `<mandatoryClean>true</mandatoryClean>`，请 `clean` 与目标生命周期同次执行。
    
- 这次构建无可缓存任务：只跑 aggregator 或非缓存目标。
    
- 报告里能看到 `SAVE_DISABLED`、`MANDATORY_CLEAN_NOT_PERFORMED` 等原因。
    

### 2. `Unrecognised tag: 'saveToRemote'`

- 把 `saveToRemote` 写成了**子标签**。修正为 `<remote saveToRemote="...">` 的**属性**；命名空间也要对。
    

### 3. Gradle 报“不允许不安全协议”

- 加：`isAllowInsecureProtocol = true`（仅 HTTP 临时使用）。更好的做法是给 BCN/Nexus 配 HTTPS。
    

### 4. 依赖解析 404 被缓存（Maven）

- 强制刷新：`mvn -U package`；
    
- 或清理本地坐标目录 / `.lastUpdated`；
    
- 确认私有库已部署在 Nexus 的 `maven-hosted`，并配置了 mirrors/权限。
    

### 5. 怎么清本地 Maven 仓库（选其一）

```bash
# 精确清单个坐标版本
rm -rf ~/.m2/repository/group/artifact/1.2.3

# 或插件
mvn dependency:purge-local-repository -DreResolve=true -DincludeGroupIds=ccsp

# 大招：整库清空（慎用）
rm -rf ~/.m2/repository/*
```

---

# 成本与收益（实践观察）

- **落地成本**：
    
    - Nexus：单机 2 vCPU / 8GB RAM 起步即可，Raw(hosted) 配置非常轻量；
        
    - BCN：一个容器即可跑起，默认 5071（HTTP）/6011（Bazel gRPC）。
        
- **收益**：
    
    - 第二次构建极大提速；多人/多机/CI 复用显著；
        
    - 失败率降低：波动插件/环境变量被“冻结”为稳定输入后，缓存复现稳定；
        
    - 运维：通过 Nexus/反代统一治理权限、清理/备份一处做起。
        

---

# 最终选型的原因

1. **兼容性与开源**：Maven 使用官方的 Build Cache Extension（开源）、Nexus OSS（开源）即可闭环；Gradle 天然支持远程缓存，BCN 是官方实现、协议稳定。
    
2. **分治不耦合**：两边协议不同，各用专长组件，避免“强行打通”的额外复杂度与风险。
    
3. **可渐进演进**：先在内网 HTTP 跑通，再切 HTTPS/细化权限/做分环境；Gradle 可在 BCN 与 Nexus 间灵活切换。
    
4. **可观测可回滚**：Nexus UI/日志与 Gradle/Maven 的调试开关让定位问题很直接；任何一步配置都可独立回退。
    

---

# 附：Nginx 统一入口（可选）

```nginx
server {
  listen 80;
  server_name cache.example.com;

  # Gradle -> BCN
  location /gradle-cache/ {
    proxy_pass http://bcn:5071/cache/;
    # 可限制方法与来源网段
    # limit_except GET HEAD PUT { deny all; }
  }

  # Maven -> Nexus Raw(hosted)
  location /maven-cache/ {
    proxy_pass http://nexus:8081/repository/build-cache/maven/;
  }
}
```

---

# 收尾建议

- 先做一次**CI 种子构建**（开启远端写入），确认 Nexus/BCN 出现缓存条目；
    
- 第二次在另一台/清理后构建，观察命中与耗时下降；
    
- 建立**“开发只读，CI 写入”的组织约定**，并将缓存键入规则纳入代码评审（防止把脏状态写入远端）；
    
- 每月检查一次命中率与存储占用，调整 Cleanup Policy 与输入排除规则。
    
