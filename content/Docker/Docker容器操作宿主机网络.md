# Docker容器操作宿主机网络

# 说明

Docker容器中使用nmcli操作宿主机网络，需要

1.  启动容器时将D-Bus挂在到容器中
    
2.  授予容器相关权限（特权模式或者只授予网络权限）
    
3.  容器中安装dbus，并设置环境变量（这一步有的镜像可能已经制作好，只需要在启动时指定环境变量即可，对于一些基础镜像需要在制作镜像时下载dbus）
    

# 启动

## docker

使用docker命令启动（特权模式）

```shell
docker run -d --privileged   -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket 192.168.7.114/zhang/redis
```

或者使用添加网络功能的方式启动

```shell
docker run -d   --cap-add=NET_ADMIN   --cap-add=NET_RAW   -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket 192.168.7.114/zhang/redis
```

如果目标镜像中**没有**dbus时，需要进入容器或者在制作容器时，下载安装dbus~~并设置环境变量~~

```shell
apt-get install -y dbus
```
```shell
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
# 经过测试，上面的环境变量可以不用设置
```

测试dbus连接

```shell
dbus-send --system --dest=org.freedesktop.DBus --type=method_call \
  --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames
```

## docker-compose

使用docker-compose启动（特权模式）

```yaml
version: '3'
services:
  redis:
    image: 192.168.7.114/zhang/redis
    container_name: redis_container
    privileged: true
    volumes:
      - /run/dbus/system_bus_socket:/run/dbus/system_bus_socket
    restart: always
```

或者添加网络功能启动

```yaml
version: '3'
services:
  your_service_name:
    image: 192.168.7.114/zhang/redis
    container_name: your_container_name
    cap_add:
      - NET_ADMIN
      - NET_RAW
    volumes:
      - /run/dbus/system_bus_socket:/run/dbus/system_bus_socket
    environment:
      - DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
    restart: always
```

dbus的问题和使用docker启动类似

# 注意事项

1.  在容器中使用`nmcli`和`firewall`命令可以操作宿主机的网络和防火墙，但是使用`ip -a`命令获取到的是容器的网络
    
2.  ~~在一些机器上可能会有权限问题~~    
    
3.  可以在docker-compose中指定`user: "${UID}:${GID}"`或者在docker命令中指定  `-u $(id -u):$(id -g)`来实现在启动容器时指定用户和组 ID，与宿主机上的用户和组相匹配（未测试）
    
4.  如果在启动时指定了`/sbin/init`的 entrypoint 时，需要添加`--tmpfs /run --tmpfs /tmp`这两段指令，才能在容器内部正常使用nmcli命令
    

```shell
docker run -d --privileged -v /sys/fs/cgroup:/sys/fs/cgroup:ro -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket --tmpfs /run --tmpfs /tmp --entrypoint /sbin/init hsm:v0.0.2
```