# Docker使用systemd

1.  在一些镜像中可能无法使用systemd，在运行`systemctl`命令时，会报
    

```shell
System has not been booted with systemd as init system (PID 1). Can't operate.
Failed to connect to bus: Host is down
```

或类似的错误，是由于systemd是`init`系统

```shell
init 系统是 Linux 系统启动过程中的第一个进程，负责初始化系统并启动所有其他进程。它是系统的“初始化系统”或“初始化守护进程”（PID 1），因此它是操作系统启动后的第一个进程，控制系统的运行级别、启动服务和进程、以及管理系统的关闭或重启。init 系统的职责是确保系统能启动并正常运行各项服务。
```

在一些docker镜像中可能没有包含或者使用的init系统不是systemd

# 解决方案

1.  在镜像中安装systemd，根据镜像的不同，可能会有不同的要求，部分镜像可能会报
    

```shell
The following packages have unmet dependencies:
 systemd : Depends: libsystemd0 (= 241-7~deb10u10) but 247.3-6 is to be installed
           Recommends: libpam-systemd but it is not going to be installed
           Recommends: dbus but it is not going to be installed
E: Unable to correct problems, you have held broken packages.
```

或类似的错误，可以执行`apt install libsystemd0=241-7~deb10u10`（根据实际情况）和`apt install systemd`命令安装

2.  启动容器时，开启特权模式，并配置--entrypoint /sbin/init
    

```shell
docker run --privileged -d --entrypoint /sbin/init test-docker-systemd:1.0
```

进入容器后可以正常使用systemctl命令

# 注意事项

1.  当需要在容器内部使用`nmcli`命令操作宿主机时，需要在启动容器时，添加`--tmpfs /run --tmpfs /tmp`这两段指令
    

```shell
docker run -d --privileged -v /sys/fs/cgroup:/sys/fs/cgroup:ro -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket --tmpfs /run --tmpfs /tmp --entrypoint /sbin/init hsm:v0.0.2
```