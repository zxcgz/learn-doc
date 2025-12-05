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
在SDK开发中，如果涉及到需要提供两个aar包，并且两个aar包中同时包含着相同的