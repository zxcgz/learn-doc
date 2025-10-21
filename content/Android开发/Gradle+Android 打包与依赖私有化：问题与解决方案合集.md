## 问题 1：报错 *Build was configured to prefer settings repositories over project repositories*
**完整错误**：
```
Build was configured to prefer settings repositories over project repositories but repository 'MavenRepo' was added by build file 'xxx/build.gradle'
```
### 解决方案
**方案 A（推荐）**：把所有仓库声明迁移到根 `settings.gradle`，并保持集中管理。
```groovy
// settings.gradle
pluginManagement {
  repositories {
    gradlePluginPortal()
    google()
    mavenCentral()
    // maven { url 'https://your.repo' }
  }
}
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS) // 或 FAIL_ON_PROJECT_REPOS
  repositories {
    google()
    mavenCentral()
    // mavenLocal()
    // maven { url 'https://your.repo'; name 'MavenRepo' }
  }
}
```
删除各模块 `build.gradle` 中的 `repositories {}`。

**方案 B**：确实需要在模块声明仓库，将模式改为项目优先。
```groovy
// settings.gradle
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
  repositories { google(); mavenCentral() }
}
```

**方案 C**：定向某些依赖到私有仓库。
```groovy
repositories {
  google(); mavenCentral()
  exclusiveContent {
    forRepository { maven { url 'https://your.repo'; name 'MavenRepo' } }
    filter { includeGroupByRegex 'com\\.yourco(\\..*)?' }
  }
}
```

---

## 问题 2：Android 模块如何引入 `.so` 动态库
### 解决方案
**方式 1：不使用 CMake，直接放入 `jniLibs/`**
```
app/
 └─ src/main/jniLibs/
     ├─ arm64-v8a/   libmylib.so
     ├─ armeabi-v7a/ libmylib.so
     ├─ x86/         libmylib.so   (可选)
     └─ x86_64/      libmylib.so   (可选)
```
```groovy
android {
  defaultConfig {
    ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }
  }
}
```
Java 调用：
```java
static { System.loadLibrary("mylib"); } // 对应 libmylib.so
```

**方式 2：有本地代码，使用 CMake 导入预编译 .so**
```cmake
# CMakeLists.txt
add_library(mylib SHARED IMPORTED)
set_target_properties(mylib PROPERTIES
  IMPORTED_LOCATION ${CMAKE_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libmylib.so)

add_library(native-lib SHARED native-lib.cpp)
find_library(log-lib log)
target_link_libraries(native-lib mylib ${log-lib})
```

**方式 3：做成 AAR 提供给别人**  
将 `.so` 放 `library/src/main/jniLibs/<ABI>/`，AAR 会自动携带。必要时在 `consumer-rules.pro` 下发 keep 规则。

**常见问题排查**：ABI 不匹配/库名不匹配/缺少依赖 `.so`/方法数过多需开启 MultiDex 等。

---

## 问题 3：如何把三方依赖“私有化”以避免冲突（Shading/Relocation）
### 解决方案（Gradle Shadow 插件）
```groovy
plugins {
  id 'java-library'
  id 'com.github.johnrengelman.shadow' version '8.1.1'
}
dependencies {
  implementation 'com.google.guava:guava:33.2.1-jre'
}
tasks.named('shadowJar') {
  archiveClassifier.set('all')
  relocate 'com.google.common', 'com.yourco.shaded.guava' // 关键
  mergeServiceFiles()
  exclude 'META-INF/*.SF','META-INF/*.DSA','META-INF/*.RSA'
}
```
**注意**：字符串里的类名不会被自动改；涉及 `ServiceLoader` 的库要合并 `META-INF/services/*`；许可证文件的合规；对于 JNA 等涉及本地库的依赖，重定向后务必做真机回归。

---

## 问题 4：在 Android Studio 中实现依赖重定向（AAR 场景）
### 解决方案（推荐路线）
**JVM 子模块做重定向 → Android AAR 模块只消费结果**：
```
:SDK（com.android.library） 依赖 → :sdk-java-shadow（java-library + Shadow）
```
JVM 子模块产出 `*-all.jar`，AAR 模块通过 **模块变体** 或 **复制到 libs/** 的方式携带。

---

## 问题 5：Shadow 报错 *Resolving configuration 'shadow' is not allowed (canBeResolved=false)*
### 解决方案
不要覆写插件内部的 `shadow` 配置。对外另建一个可消费配置挂载产物：
```groovy
tasks.named('shadowJar') { /* ... */ }
configurations {
  create('shaded') {
    canBeConsumed = true
    canBeResolved = false
  }
}
artifacts { add('shaded', tasks.named('shadowJar')) }
```
或将 `shadowJar` 设为默认归档产物（关闭普通 jar）。

---

## 问题 6：`publishing {}` 报 *Could not find method publishing()*
### 解决方案
缺少 `maven-publish` 插件。
```groovy
plugins { id 'maven-publish' }
publishing {
  publications {
    create('shaded', MavenPublication) {
      groupId = 'com.yourco'
      artifactId = 'sdk-java-shadow'
      version = '1.0.0'
      artifact(tasks.named('shadowJar'))
    }
  }
  repositories { mavenLocal() }
}
```

---

## 问题 7：打包 Android 时能否自动发布 Java 模块并引用
### 解决方案
**方式 A（更简单）**：不发布。直接从 `:sdk-java-shadow` 解析并复制产物到 `:sdk/libs/`，AAR 会携带。见“问题 10 的方案 A”。  
**方式 B**：自动发布到 `mavenLocal` 再用坐标依赖。
```groovy
// settings.gradle
dependencyResolutionManagement { repositories { google(); mavenCentral(); mavenLocal() } }

// sdk/build.gradle
dependencies {
  implementation("com.yourco:sdk-java-shadow:1.0.0-SNAPSHOT:all") { changing = true }
}
tasks.configureEach { t ->
  if (t.name.matches(/(compile.*Java|extract.*Annotations|merge.*JavaResource).*/)) {
    t.dependsOn(":sdk-java-shadow:publishShadedPublicationToMavenLocal")
  }
}
configurations.all { resolutionStrategy.cacheChangingModulesFor 0, 'seconds' }
```

---

## 问题 8：变体匹配失败 *Could not select a variant of project :sdk-java-shadow*
**常见报错**：
```
Could not select a variant of project :sdk-java-shadow that matches the consumer attributes.
```
### 解决方案
不要混用“工程依赖”和“坐标依赖”。若走工程依赖，给对外配置补齐属性：
```groovy
configurations {
  create('shaded') {
    canBeConsumed = true; canBeResolved = false
    attributes {
      attribute(Usage.USAGE_ATTRIBUTE, objects.named(Usage, Usage.JAVA_RUNTIME))
      attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category, Category.LIBRARY))
      attribute(LibraryElements.LIBRARY_ELEMENTS_ATTRIBUTE, objects.named(LibraryElements, LibraryElements.JAR))
      attribute(Bundling.BUNDLING_ATTRIBUTE, objects.named(Bundling, Bundling.EXTERNAL))
      attribute(TargetJvmVersion.TARGET_JVM_VERSION_ATTRIBUTE, 11)
    }
    outgoing.artifact(tasks.named('shadowJar'))
  }
}
```
下游只写：
```groovy
implementation project(path: ':sdk-java-shadow', configuration: 'shaded')
```

---

## 问题 9：AAR 中 `classes.jar` 为空
### 解决方案
这是预期行为：`classes.jar` 只包含**库模块自身**的类。要把上游 shaded 产物随 AAR 一起带走：

**方案 A（推荐）**：复制到 `libs/`，以文件依赖打包进 AAR。
```groovy
// sdk/build.gradle
dependencies { implementation fileTree(dir: 'libs', include: ['*.jar']) }

// 解析并复制上游 shaded 产物
configurations {
  shadedFromShadow {
    canBeResolved = true; canBeConsumed = false
    attributes {
      attribute(Usage.USAGE_ATTRIBUTE, objects.named(Usage, Usage.JAVA_RUNTIME))
      attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category, Category.LIBRARY))
      attribute(LibraryElements.LIBRARY_ELEMENTS_ATTRIBUTE, objects.named(LibraryElements, LibraryElements.JAR))
      attribute(Bundling.BUNDLING_ATTRIBUTE, objects.named(Bundling, Bundling.EXTERNAL))
      attribute(TargetJvmVersion.TARGET_JVM_VERSION_ATTRIBUTE, 11)
    }
  }
}
dependencies {
  shadedFromShadow project(path: ':sdk-java-shadow', configuration: 'shaded')
}
tasks.register('copyShadedIntoLibs', Copy) {
  from(configurations.shadedFromShadow)
  into("$projectDir/libs")
}
preBuild.dependsOn('copyShadedIntoLibs')
```
**方案 B**：使用 `com.kezong.fat-aar` 的 `embed` 把类合并进 `classes.jar`。

---

## 问题 10：跨模块复制时，`shadowJar` 任务找不到
**完整错误**：
```
Task with name 'shadowJar' not found in project ':sdk-java-shadow'
```
### 解决方案
**方式 1（推荐）**：不要直接拿任务，改为“解析可消费变体再复制”。见“问题 9 的方案 A”。

**方式 2**：仍要拿任务名，先确保上游完成评估：
```groovy
evaluationDependsOn(':sdk-java-shadow')
def shadedJarTask = project(':sdk-java-shadow').tasks.named('shadowJar')
tasks.register('copyShadedIntoLibs', Copy) {
  dependsOn(shadedJarTask)
  from(shadedJarTask.map { it.archiveFile })
  into("$projectDir/libs")
}
preBuild.dependsOn('copyShadedIntoLibs')
```

---

## 问题 11：NDK 提示 *did not have a source.properties* 且无法 strip `.so`
### 解决方案
安装有效的 **NDK (Side by side)** 版本，并与 `build.gradle` 对齐：
```groovy
android { ndkVersion "27.0.12077973" } // 按本机已安装版本填写
```
或清理无效的 NDK 路径，改用可用版本。

---

## 附：JNA 重定向提示
- JNA 包名为 `com.sun.jna`。若重定向（`relocate 'com.sun.jna', '...'`），务必做真机回归（本地库加载、资源路径）。
- 如果不是硬性要求，常见做法是：**内嵌 JNA 不重定向**，只控制版本与冲突。

---

## 快速验证命令
```bash
# 查看上游是否存在 shadowJar 任务
./gradlew :sdk-java-shadow:tasks --all | grep -i shadowJar

# 干跑任务图，确认自动构建上游
./gradlew :sdk:assembleDebug --dry-run

# 打包并检查 AAR 内容
./gradlew :sdk:assembleDebug
unzip -l sdk/build/outputs/aar/sdk-debug.aar | sed -n '1,200p'
```
