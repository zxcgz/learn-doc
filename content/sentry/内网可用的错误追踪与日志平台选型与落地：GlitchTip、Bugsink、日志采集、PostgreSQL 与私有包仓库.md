---
title: 内网可用的错误追踪与日志平台选型与落地：GlitchTip、Bugsink、日志采集、PostgreSQL 与私有包仓库
date: 2025-10-31
tags:
  - error-tracking
  - glitchtip
  - bugsink
  - sentry
  - logging
  - openobserve
  - loki
  - opensearch
  - postgresql
  - nexus
  - npm
  - maven
  - android
  - java
---

> 目标：在纯内网环境，搭建“可落地、可维护”的错误追踪与日志方案；明确 GlitchTip 与 Bugsink 的取舍，给出 PostgreSQL 部署与调优、日志采集栈、以及极简的 npm/Maven 仓库实现路径。

## 一、结论速览

- **Sentry 自建**：整套压到 ~1 GB 内存不可行；现代版本强依赖 Kafka/ClickHouse/Snuba，建议 ≥16 GB RAM（32 GB 推荐）。
- **GlitchTip vs Bugsink**：
  - GlitchTip：MIT 许可证；**PostgreSQL ≥14 + Redis/Valkey**；兼容 Sentry API；支持 JS Source Maps、原生平台符号化（dSYM/ProGuard/NDK）；提供 API；可在**无容器**环境部署。
  - Bugsink：Polyform Shield 许可（允许自托管生产使用，不可作为竞争服务提供）；**SQLite 入门 / MySQL 正式**；专注错误追踪；支持 JS Source Maps；**不支持 Android/Java 的在线符号化**（无 mapping 上传）。
- **日志平台（全量运行日志）**：用 **OpenObserve**（单体、AGPL、内置 UI、REST/SQL API）、或 **VictoriaLogs/Parseable** + 轻量 Agent（Fluent Bit / Vector / OTel Collector / Alloy）。
- **PostgreSQL**：Linux 下用系统包即可安装；轻量化后**几百 MB RAM**可运行，小型生产建议**≥2 GB**。给出最小化 `postgresql.conf` 片段。
- **私有包仓库（npm + Maven）**：首选 **Nexus Repository OSS**（Java 服务，现成）；若只读、只有少量私有包，可用一个**极简 Spring Boot** 服务暴露只读 npm 元数据与 Maven 静态目录。

## 二、GlitchTip 与 Bugsink 对比

| 维度 | GlitchTip | Bugsink |
|---|---|---|
| 许可 | **MIT**（可商用、可再发行） | **Polyform Shield**（允许生产自托管；不可对外提供作为竞争服务） |
| 数据库/依赖 | **PostgreSQL ≥14** + Redis/Valkey | **SQLite**（入门）或 **MySQL**（推荐） |
| SDK/协议 | 兼容 Sentry API/SDK | 兼容 Sentry API/SDK |
| 符号化（Android/Java/iOS/原生） | **支持**（mapping/dSYM/DIF 上传与解析） | **不支持 Android/Java 符号化**；支持前端 **JS Source Maps** |
| 性能/可用性监控 | 提供性能追踪、Uptime | 以错误追踪为主 |
| API/自动化 | 提供 /api/0/ 风格 API、Webhook、Prom 指标 | 提供公开 API、Webhook；适合二次开发 |
| 部署 | Docker/Helm/裸机可行（裸机需自行运维 uWSGI/Gunicorn、Celery、Nginx） | Docker Compose/Helm；单服务为主，资源占用小 |
| 适用场景 | 追求开源协议宽松、移动端/原生符号化、Sentry 生态最大兼容 | 偏 MySQL 栈、极简部署、主要前端/后端错误（不依赖原生符号化） |

**决策建议**：
- 需要 Android/iOS/NDK **完备符号化** → 选 **GlitchTip**。  
- 主要前端/后端错误 + **MySQL** 偏好 → 选 **Bugsink**。

## 三、在内网部署 GlitchTip（无容器要点）

> 架构最小集：GlitchTip Web（Django/uWSGI 或 Gunicorn）+ Celery Worker + **PostgreSQL 14+** + **Redis/Valkey** +（可选）Nginx。

1. **获取版本匹配的后端与前端构建**（前端 `dist/glitchtip-frontend` 放到后端 `dist/` 下，版本号一致）。  
2. **环境变量（最小）**：`SECRET_KEY`、`GLITCHTIP_DOMAIN`、`DATABASE_URL`、`REDIS_URL`、`EMAIL_URL`。  
3. **初始化**：`manage.py migrate` → `manage.py collectstatic`。  
4. **常驻**：uWSGI/Gunicorn + systemd，Celery Worker 常驻。

## 四、PostgreSQL：Linux 安装与轻量调优

**安装（Ubuntu/RHEL）**
```bash
# Ubuntu
sudo apt update && sudo apt install -y postgresql
sudo systemctl enable --now postgresql

# RHEL / Rocky / Alma
sudo dnf install -y postgresql-server
sudo /usr/bin/postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

**远程访问（内网）**
```
# postgresql.conf
listen_addresses = '0.0.0.0'

# pg_hba.conf（示例）
host all all 10.0.0.0/8 scram-sha-256
```

**轻量化参数建议**

_开发/CI（≤1 GB RAM）_
```conf
max_connections = 20
shared_buffers = 128MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 256MB
wal_compression = on
logging_collector = on
```

_小型生产（~2 GB RAM）_
```conf
max_connections = 50
shared_buffers = 512MB
work_mem = 8MB
maintenance_work_mem = 256MB
effective_cache_size = 1GB
wal_compression = on
```

> 保持 autovacuum 开启。`work_mem` 为每个排序/哈希操作的上限，非每连接常驻。

## 五、全量运行日志：小体量方案

- **OpenObserve**：单体服务、内置 Web UI、REST/SQL API、OTel 兼容；官方 Agent 提供 Linux/Windows/macOS 采集。  
- **VictoriaLogs**：单二进制 + 多协议写入；配合 **OTel Collector(filelog)** 或 **Promtail/Fluent Bit/Vector** 做文件 tail。  
- **Promtail（Loki）→ Alloy（新）**：Promtail 将进入 LTS，建议新部署用 Alloy。  
- **Fluent Bit / Vector**：跨平台 Agent，支持 `tail`、`journald`、Windows 事件日志与 Kubernetes 自动发现。

**思路**：应用按常规写日志到文件/stdout → Agent 自动采集（tail + 轮转/断点）→ 后端（OpenObserve/Loki/OpenSearch）。

## 六、Bugsink：Android/Java 符号化工作流（离线自动化）

> Bugsink 不支持 mapping/dSYM 上传；采用**自行反混淆**方案。

**步骤**：
1. **设置版本标识**（Android/Java SDK）
   ```kotlin
   // Android
   SentryAndroid.init(app) { o ->
     o.dsn = "https://<public>@<bugsink>/<projectId>"
     o.release = "${BuildConfig.APPLICATION_ID}@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
     o.dist = BuildConfig.VERSION_CODE.toString()
     o.environment = "prod"
   }
   ```
   ```java
   // Java 服务端
   Sentry.init(o -> {
     o.setDsn("https://<public>@<bugsink>/<projectId>");
     o.setRelease("my-service@1.2.3+20251031");
     o.setEnvironment("prod");
   });
   ```

2. **归档 mapping.txt**  
   以 `proguard_uuid` 或 `appId@ver+code/<dist>/mapping.txt` 规则存放。

3. **自动化反混淆**  
   - 触发：Bugsink **Webhook**（新/恶化的 Issue）或定时 **API 轮询**。  
   - 动作：在自研 Java 服务调用 **R8/ProGuard Retrace**，用对应版本的 `mapping.txt` 将栈还原。  
   - 可选：把“已还原栈”回写到自有系统，或以新事件的形式回投（标注 `symbolicated:true`、`original_event_id` 等）。

**Retrace（CLI 样例）**
```bash
java -jar retrace.jar -quiet /path/to/mapping.txt < /tmp/obfuscated.stack > /tmp/deobf.stack
```

**Retrace（作为库，示意）**
```xml
<!-- Maven -->
<dependency>
  <groupId>com.guardsquare</groupId>
  <artifactId>proguard-retrace</artifactId>
  <version>7.8.0</version>
</dependency>
```

## 七、Bugsink：手动日志与检索

- **手动日志**：Sentry SDK 的 `captureMessage` / `captureException` 直接可用（DSN 指向 Bugsink）。
- **附带堆栈**：开启 `attachStacktrace=true`，或用 `captureException`。  
- **按版本检索**：使用 `release/dist` 标签；自定义 tag（如 `git_sha`, `build_type`）便于筛选。

## 八、Bugsink：保留与清理

- 无“保留 N 天自动删除”的内置策略；采用**智能保留**。  
- 需要强制合规删除：用 **API + 定时任务** 按时间筛选并删除 Issue（事件随 Issue 一并清理）。

**清理脚本思路（伪 Python）**
```python
import requests, datetime
BASE = "https://bugsink.internal"
TOKEN = "xxx"
days = 90
since = (datetime.datetime.utcnow() - datetime.timedelta(days=days)).isoformat() + "Z"

def list_issues(page):
    return requests.get(f"{BASE}/api/canonical/0/issues", params={"page": page, "per_page": 100},
                        headers={"Authorization": f"Bearer {TOKEN}"}).json()

def delete_issue(issue_id):
    requests.delete(f"{BASE}/api/canonical/0/issues/{issue_id}",
                    headers={"Authorization": f"Bearer {TOKEN}"})

page = 1
while True:
    data = list_issues(page)
    if not data: break
    for it in data:
        if it["last_seen"] < since:
            delete_issue(it["id"])
    page += 1
```

## 九、私有包仓库（npm + Maven）

**首选：Nexus Repository OSS（Java）**
```bash
docker run -d --name nexus -p 8081:8081 sonatype/nexus3
# 也可直接在 JVM 上运行：下载解压 → bin/nexus start
```
后台创建 `npm(hosted)` 与 `maven-releases/snapshots(hosted)`，即可 `npm publish` 与 `mvn deploy`。

**极简只读（少量包）**
- 用一个小型 **Spring Boot**：
  - `/maven2/**` 直接映射磁盘目录（Maven 静态结构）。
  - `/npm/<pkg>` 返回该包的 metadata JSON（含各版本 tarball URL）；`/npm/<pkg>/-/<tgz>` 回 tarball。
- 目录示例：
  ```text
  /data/repo/
   ├─ maven2/com/example/demo/1.0.0/{demo-1.0.0.pom, demo-1.0.0.jar, maven-metadata.xml}
   └─ npm/@scope/pkg/1.0.0/{package.json, pkg-1.0.0.tgz}
  ```
- 客户端：Maven 使用该 URL 作为仓库；npm 用 `.npmrc` 指定 `@scope:registry`。

## 十、FAQ / 备忘

- **GlitchTip 只能用 PostgreSQL 吗？** 是。不可改为 MySQL/MariaDB。  
- **PostgreSQL 有“嵌入式版本”吗？** 无。可在测试中用“embedded-postgres 启动器”起子进程，但不是 in-process 引擎。  
- **Sentry 自建能压到 1 GB RAM 吗？** 不现实；用 GlitchTip/Bugsink 之类轻量方案更合适。

---

### 附：调参与清单模板

**GlitchTip（环境变量示例）**
```env
SECRET_KEY=changeit
GLITCHTIP_DOMAIN=https://gt.intra.local
DATABASE_URL=postgres://gt:pass@10.0.0.2:5432/gt
REDIS_URL=redis://10.0.0.3:6379/0
EMAIL_URL=smtp://user:pass@mail.intra.local:25
```

**Android 版本打点规范（建议统一）**
```
release = <applicationId>@<versionName>+<versionCode>
dist    = <versionCode>
environment = prod|staging|dev
```

**mapping 归档命名**
```
/mappings/<applicationId>/<release>/<dist>/mapping.txt
```

**Bugsink API 使用要点**
- 在实例的 Swagger UI 浏览端点（issues/events/projects）。
- 用 `Bearer <Token>` 鉴权。
- 典型字段：`id`、`title`、`culprit`、`first_seen`、`last_seen`、`tags[]`、`event.payload`。

---

> 以上内容用于内部落地与长期维护，可直接复制到 Obsidian 使用。
