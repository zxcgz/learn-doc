# JNA

Java Native Access (JNA) 是一个由社区开发的库，它使Java程序无需使用Java Native Interface即可轻松访问本地共享库。JNA的设计旨在以最少的努力以原生的方式提供本地访问，且不需要样板代码或胶水代码。

## Android中使用JNA

在Android中使用JNA和在PC端使用有一定的区别

###  句柄

在使用JNA调用动态库中的函数，并传递一个指针用来接收动态库返回的句柄时，在PC端开发时使用`PointerByReference`，但是在Andorid中使用这个类的对象时存在指针错误的问题，`PointerByReference`这个类里面有两个地址，一个对象的地址，一个native的地址，正常情况下，so库接收到的应该是里面的native地址，在PC端也正是如此。在Android中不知道为什么动态库接收到的是对象地址，导致引用错误。

一个存在的解决办法是调用native函数时正常传递`PointerByReference`，在函数返回后将对象中的native地址重新封装

```java
Pointer.createConstant(phApplication.getPointer().getLong(0));
```

成一个Pointer对象，之后调用时传递`Pointer`对象，这样之后使用动态库就可以正常的获取到地址。

**需要注意的是**，上面的代码只在64位系统中生效，当运行环境是32位时，上面的代码会报

```java
java.lang.IndexOutOfBoundsException: Bounds exceeds available space : size=4, offset=8
```

错误，因为getLong内部会对长度进行判断防止越界，long类型的长度（size）为8，即64位，但是32位系统中地址长度为32位，所以需要判断系统架构，当位32位时，调用

```java
Pointer.createConstant(pointerByReference.getPointer().getInt(0))
```

### jnaerator

jnaerator生成的结构体在Android中直接使用可能会出现问题。

一个例子是`NativeLong`类，在jnaerator生成时出现`NativeLong`时直接使用可能会由于长度错误导致后续内容的地址错误，可能需要将其修改成正确的基本数据类型

### 基本数据类型

jna在Android上使用时，基本数据类型存在一定的问题，在某些情况下，使用long类型和使用int类型都能正常编译和运行，但是在使用long类型时，在32位系统上可能会出现异常，异常类似于`NativeLong`的情况，将long类型替换成int类型即可解决