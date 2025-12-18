---
title: 在AndroidStudio中使用java模块引用Android独有类
created: 2025-12-05
description: 在AndroidStudio中使用java模块引用Android独有类
tags:
  - android
  - 开发
  - Android
  - AndroidStudio
  - Gradle
---
### 1. 由来
在AndroidStudio中Android模块引用Android模块，不管是直接源码引用还是引用aar包，在最终的打包产物`aar` 中都不会包含这个被应用模块中的代码。  
在SDK开发中，如果涉及到需要提供两个aar包，并且两个aar包中同时包含着相同的代码时，一种好的做法是将相同的代码抽取到一个基础库中，如果这个基础库使用Android模块，则基础库中的代码不会出现在任意一个aar中，此时可以使用java模块来实现
### 2. 实现
创建一个java模块，修改build.gradle
```groovy
plugins {  
    id 'java-library'  
}  
  
def localProps = new Properties()  
localProps.load(rootProject.file('local.properties').newDataInputStream())  
def sdkDir = localProps['sdk.dir']  
  
def platformsDir = new File(sdkDir, "platforms")  
  
def latestAndroidJar = (platformsDir.listFiles() ?: [])  
        .collect { dir ->  
            // 匹配 android-33、android-33-ext4 这类，取出前面的数字 33            def matcher = (dir.name =~ /android-(\d+)/)  
            if (matcher.find() && new File(dir, "android.jar").exists()) {  
                int api = matcher.group(1) as int  
                return [api: api, jar: new File(dir, "android.jar")]  
            } else {  
                return null  
            }  
        }  
        .findAll { it != null }  
        .max { it.api }  
        ?.jar  
  
if (latestAndroidJar == null || !latestAndroidJar.exists()) {  
    throw new GradleException("在 ${platformsDir} 下没有找到任何 android-*/android.jar，请检查 Android SDK 安装")  
}  
  
  
// 这里选择你要对齐的 Android 平台版本  
dependencies {  
    compileOnly files(latestAndroidJar)  
    // 还可以有别的 compileOnly 依赖  
    // compileOnly "androidx.annotation:annotation:1.9.0"  
}  
  
java {  
    sourceCompatibility JavaVersion.VERSION_1_8  
    targetCompatibility JavaVersion.VERSION_1_8  
}
```

这样java模块就可以直接引用Android中类似Context之类的引用