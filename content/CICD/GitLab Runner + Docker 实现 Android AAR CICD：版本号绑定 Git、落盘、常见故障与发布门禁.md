---
title: "GitLab Runner + Docker 实现 Android AAR CI/CD：版本号绑定 Git、落盘到 /home、常见故障与发布门禁"
created: 2025-12-18
tags:
  - "GitLab"
  - "CI/CD"
  - "Android"
  - "AAR"
  - "Docker"
  - "Gradle"
  - "Flutter"
  - "DevOps"
---

## 摘要

本文给出一套可直接落地的 Android AAR 持续集成与持续交付方案，基于 GitLab Runner（Docker executor）实现：

- AAR 自动构建（`bundleReleaseAar`）
- 版本号自动注入并与 Git 提交信息绑定（BuildConfig 常量 + AAR 内置 `build-info.json`）
- CI 产生的构建工作区、缓存与 Docker 镜像层/卷数据统一落盘到 `/home`，避免小分区写满
- 常见构建错误的定位与修复（权限、JDK/Gradle 版本、`local.properties`、Flutter embedding 依赖等）
- 发布门禁：CI 通过后才允许进入主分支，并实现“仅由 CI 成功后创建 Tag/发布分支”的严格发布模式

---

## 1. 环境与目标

### 1.1 核心组件

- GitLab Runner：Docker executor
- 构建镜像：`cimg/android:2024.01.1`（JDK 17 环境）
- Gradle：项目使用 Gradle 7.4（与 JDK 17 兼容）
- 构建目标模块：`cocrypto_sdk`（Android Library）
- 构建任务：`:cocrypto_sdk:bundleReleaseAar`
- 构建产物：`cocrypto_sdk/build/outputs/aar/*.aar`

### 1.2 关键约束

- 既有 `cocrypto_sdk/build.gradle` 中“拷贝 jar / 解 so / AAR 重命名”等逻辑必须保留
- CI 中版本号与 Git 信息必须可追溯、可复现
- 产物与缓存不得写入小分区（通常为系统根分区）

---

## 2. 将 CI 相关数据统一落盘到 `/home`

Android CI/CD 常见磁盘压力来自两部分：

1. Runner 工作区与缓存（构建中间产物、Gradle 缓存）
2. Docker 自身数据（镜像层、容器可写层、volume）

两者必须同时迁移，才能避免“镜像又下载回小分区”的问题。

### 2.1 Runner 工作区与缓存落盘到 `/home`

编辑 `/etc/gitlab-runner/config.toml`，将容器内 `/builds`、`/cache` 映射到宿主机 `/home`：

```toml
concurrent = 1

[[runners]]
  name = "Android-CI/CD"
  executor = "docker"

  builds_dir = "/builds"
  cache_dir  = "/cache"

  [runners.docker]
    image = "cimg/android:2024.01.1"
    volumes = [
      "/home/gitlab-runner/builds:/builds:rw",
      "/home/gitlab-runner/cache:/cache:rw"
    ]
````

宿主机创建目录并授权：

```bash
sudo mkdir -p /home/gitlab-runner/{builds,cache}
sudo chown -R gitlab-runner:gitlab-runner /home/gitlab-runner
sudo systemctl restart gitlab-runner
```

### 2.2 Docker data-root 迁移到 `/home`

编辑 `/etc/docker/daemon.json` 设置 `data-root`：

```json
{
  "data-root": "/home/docker-data",
  "insecure-registries": ["192.168.7.114", "192.168.7.132", "192.168.7.93"],
  "registry-mirrors": [
    "https://docker.1panel.live",
    "https://docker.m.daocloud.io"
  ]
}
```

重启并验证：

```bash
sudo systemctl restart docker
docker info | grep "Docker Root Dir"
# Docker Root Dir: /home/docker-data
```

> 迁移后，镜像拉取、layer 解压、docker volume 数据都会落在 `/home/docker-data` 对应分区。

---

## 3. CI 流水线：版本号注入、Git 绑定与 AAR 构建

流水线采用两阶段结构：

* `meta`：生成版本号与 Git 绑定信息，输出为 dotenv（`build.env`）
* `build`：生成必要的 Android 构建环境文件（`local.properties`），执行 `bundleReleaseAar`，产物归档

### 3.1 `.gitlab-ci.yml`（可直接使用）

```yaml
image: cimg/android:2024.01.1

stages:
  - meta
  - build

variables:
  # 确保可获取 tag 以支持 git describe
  GIT_DEPTH: "0"
  GIT_STRATEGY: fetch

  # 将 Gradle 缓存落在 Runner 映射的 /cache
  GRADLE_USER_HOME: "/cache/gradle/${CI_PROJECT_ID}"
  GRADLE_OPTS: "-Dorg.gradle.daemon=false -Dorg.gradle.jvmargs=-Xmx4g"

meta:
  tags: [Android-CI/CD]
  stage: meta
  script:
    - git fetch --tags --force || true
    - |
      # 版本策略：
      # - tag pipeline：VERSION_NAME = tag，确保以 v 开头
      # - 分支 pipeline：v0.0.0-<branch>.<pipeline_iid>-<shortsha>
      if [ -n "$CI_COMMIT_TAG" ]; then
        VERSION_NAME="$CI_COMMIT_TAG"
        case "$VERSION_NAME" in v*) ;; *) VERSION_NAME="v${VERSION_NAME}" ;; esac
        GIT_TAG="$CI_COMMIT_TAG"
      else
        VERSION_NAME="v0.0.0-${CI_COMMIT_REF_SLUG}.${CI_PIPELINE_IID}-${CI_COMMIT_SHORT_SHA}"
        GIT_TAG=""
      fi

      VERSION_CODE="${CI_PIPELINE_IID}"

      echo "VERSION_NAME=$VERSION_NAME"            >> build.env
      echo "VERSION_CODE=$VERSION_CODE"            >> build.env
      echo "GIT_COMMIT=$CI_COMMIT_SHA"             >> build.env
      echo "GIT_COMMIT_SHORT=$CI_COMMIT_SHORT_SHA" >> build.env
      echo "GIT_BRANCH=$CI_COMMIT_REF_NAME"        >> build.env
      echo "GIT_TAG=$GIT_TAG"                      >> build.env
      echo "GIT_DESCRIBE=$(git describe --tags --always --dirty 2>/dev/null || echo "${CI_COMMIT_SHORT_SHA}")" >> build.env
      echo "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> build.env
      echo "BUILD_NUMBER=gitlab-${CI_PIPELINE_ID}" >> build.env
  artifacts:
    reports:
      dotenv: build.env

build_aar:
  tags: [Android-CI/CD]
  stage: build
  needs: ["meta"]
  script:
    # 1) 生成 local.properties（CI 环境通常不存在该文件）
    - |
      set -e
      SDK_DIR="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
      if [ -z "$SDK_DIR" ]; then
        for p in /home/circleci/android-sdk /usr/local/android-sdk /opt/android/sdk /sdk; do
          if [ -d "$p" ]; then SDK_DIR="$p"; break; fi
        done
      fi
      if [ -z "$SDK_DIR" ] || [ ! -d "$SDK_DIR" ]; then
        echo "ERROR: Android SDK dir not found"
        env | grep -E 'ANDROID|JAVA' || true
        exit 1
      fi
      echo "sdk.dir=$SDK_DIR" > local.properties

    # 2) 使用 bash 执行 gradlew，避免 chmod/权限位问题
    # 3) 利用现有 AAR 重命名逻辑：AAR_CLASSIFIER 传入短 SHA
    - bash ./gradlew :cocrypto_sdk:bundleReleaseAar -PAAR_CLASSIFIER="g${GIT_COMMIT_SHORT}" --no-daemon
  artifacts:
    when: always
    paths:
      - cocrypto_sdk/build/outputs/aar/*.aar
```

### 3.2 关键点说明

* `dotenv`：`meta` 生成的变量会自动注入到后续 job 的环境变量中，Gradle 可通过 `System.getenv()` 读取
* `GRADLE_USER_HOME`：将 Gradle 缓存写入 `/cache`，最终落盘到 `/home/gitlab-runner/cache`
* `bash ./gradlew`：避免容器内用户无权 `chmod` 时直接失败
* `-PAAR_CLASSIFIER="g${GIT_COMMIT_SHORT}"`：借助既有 AAR 重命名逻辑，将 Git 提交短 SHA 写入文件名

---

## 4. 将版本与 Git 信息写入 AAR（不破坏既有逻辑）

版本绑定信息写入 AAR 推荐两条并行路径：

1. **BuildConfig 常量**：使用方编译期/运行时直接读取
2. **AAR 内置 `assets/.../build-info.json`**：跨语言、跨平台通用读取方式

该增强仅需在 `cocrypto_sdk/build.gradle` 追加读取环境变量、注入 `buildConfigField`、生成 assets 的任务，并将任务挂到 `preBuild`，不影响原有 jar/so 解压和重命名逻辑。

### 4.1 BuildConfig 常量建议项

* `SDK_VERSION_NAME`
* `SDK_VERSION_CODE`
* `GIT_COMMIT`
* `GIT_COMMIT_SHORT`
* `GIT_BRANCH`
* `GIT_TAG`
* `GIT_DESCRIBE`
* `BUILD_TIME`
* `BUILD_NUMBER`

### 4.2 build-info.json 建议路径

避免多模块冲突，建议放置为：

* `assets/cocrypto_sdk/build-info.json`

内容示例（由 Gradle 任务生成）：

```json
{
  "module": "cocrypto_sdk",
  "version": "v0.0.0-main.1234-abc123",
  "gitShort": "abc123",
  "gitDescribe": "v1.2.3-4-gabc123",
  "buildTime": "2025-12-18T08:00:00Z",
  "buildNumber": "gitlab-5678"
}
```

---

## 5. 常见构建故障与修复策略

### 5.1 `chmod +x ./gradlew: Operation not permitted`

**现象**：CI 中执行 `chmod` 失败，job 退出，未产生产物。
**原因**：容器内用户对挂载进来的工作区无权更改权限位。
**修复**：使用 `bash ./gradlew ...` 替代直接执行。

### 5.2 `Unsupported class file major version 65`

**现象**：Gradle 在解析 `settings.gradle` 时失败。
**原因**：JDK 21（major 65）与 Gradle 7.4 不兼容。
**修复**：选择 JDK 17 环境的镜像（如 `cimg/android:2024.01.1`），或升级 Gradle/AGP 至兼容 Java 21 的版本组合。

### 5.3 `local.properties (No such file or directory)`

**现象**：项目配置阶段崩溃。
**原因**：某模块硬读取 `local.properties`。CI 环境缺失该文件。
**修复**：在 CI 构建前自动生成 `local.properties`，至少写入 `sdk.dir`。

### 5.4 `Could not find io.flutter:flutter_embedding_release:...`

**现象**：`releaseCompileClasspath` 解析失败，导致 `extractReleaseAnnotations` 失败。
**原因**：CI 缺少 Flutter Maven 仓库配置或网络无法访问对应仓库。
**修复**：在 `settings.gradle` 或根 `build.gradle` 的 repositories 中加入：

```gradle
maven { url "https://storage.googleapis.com/download.flutter.io" }
```

如存在网络限制，应使用内网 Maven 私服对该仓库进行代理/镜像。

---

## 6. 发布门禁：CI 通过后才能发布

### 6.1 主流门禁：合并前必须 CI 成功

* 保护 `main` / `release/*` 分支
* 启用 MR 的 “Pipelines must succeed” 合并检查
* 未通过 pipeline 的 MR 无法合并进入主分支

该模式保障主干稳定，同时允许开发分支自由创建与验证。

### 6.2 严格发布：仅由 CI 成功后创建 Tag/发布分支

严格模式包含两条规则：

1. **保护 Tag**：例如保护 `v*`，仅允许 Maintainer 或发布机器人创建
2. **CI 成功后自动创建 Tag/分支**：在 pipeline 的成功阶段使用 GitLab API 创建 Tag/分支，并将凭据以受保护变量注入

典型效果为：发布 Tag 不再由人工手动创建，而是由“构建产物可复现且已通过验证”的流水线自动产出，确保 Tag 与产物一一对应、可审计、可追溯。

---

## 7. 最终落地检查表

* [ ] Runner 的 `/builds` `/cache` 映射到 `/home/gitlab-runner/...`
* [ ] Docker `data-root` 迁移到 `/home/docker-data`
* [ ] CI 使用 `cimg/android:2024.01.1`（JDK 17）
* [ ] CI 构建前生成 `local.properties`
* [ ] `bash ./gradlew` 运行 wrapper，避免 chmod 权限问题
* [ ] `meta` 阶段生成 dotenv 并注入版本与 Git 信息
* [ ] `cocrypto_sdk` 将版本与 Git 信息写入 BuildConfig 与 build-info.json
* [ ] 依赖 Flutter embedding 时配置 `download.flutter.io` Maven 仓库或内网代理
* [ ] 主分支开启合并门禁；严格发布启用保护 Tag 并由 CI 创建 Tag

---

## 附录：排障命令（CI 容器内）

```bash
java -version
bash ./gradlew --version

env | grep -E 'ANDROID|JAVA|GRADLE' || true
cat local.properties || true

bash ./gradlew :cocrypto_sdk:dependencies --configuration releaseCompileClasspath --no-daemon
```

```
::contentReference[oaicite:0]{index=0}
```
