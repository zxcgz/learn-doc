# systemd和操作宿主机网络功能共存

# 注意：此方式在获取网络信息时可以正常使用，但是在涉及到修改网络时，会出现问题

# 过程

1.  systemd需要使用dbus服务进行进程间通讯
    
2.  在容器中使用systemd，需要特权模式和映射cgroup，不需要映射dbus
    

```shell
--privileged -v /sys/fs/cgroup:/sys/fs/cgroup:ro
```

3.  在容器中操作宿主机的网络功能，需要映射dbus
    

```shell
-v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket 
```

4.  同时使用systemctl和操作宿主机网络功能时，会导致容器中的dbus.service处于fail状态，启动时会报
    

```shell
dbus.socket: Failed to create listening socket (/run/dbus/system_bus_socket): Address already in use
```

此时，nmcli和firewall命令是正常的，ip命令获取的是容器中的网络信息，但是networkmanager和firewall以及其他的所有服务都无法使用systemctl进行管理，但是可以使用systemctl进行查看

5.  解决方案
    
    1.  创建一个脚本，命名为systemctl，实现和systemctl类似的操作，脚本内部手动管理[服务](https://alidocs.dingtalk.com/i/nodes/oP0MALyR8k7bw2nnIqRjpNjz83bzYmDO)
        
        1.  systemd提供了一个api，可以编写python脚本实现和直接使用systemctl类似的功能
            
            1.  Dockerfile文件（需要准备systemctl脚本文件，见下面第四步）
                

```shell
FROM ubuntu:24.10

ENV container docker

# 禁用交互安装
ENV DEBIAN_FRONTEND=noninteractive


# 更新包列表并安装所需的软件包
RUN  unset http_proxy && unset https_proxy && apt-get update -y && \
    apt-get install -y \
    iproute2 \
    iputils-ping \
    procps \
    telnet \
    pciutils \
    rpm \
    vim \
    kmod \
    policycoreutils \
    libpcre3 \
    libpcre3-dev \
    usbutils \
    gcc \
    g++ \
    gdb \
    snmp \
    openssh-client \
    chrony \
    tcpdump \
    keepalived \
    bc \
    selinux-policy-default \
    dbus \
    network-manager \
    systemd \
    systemd-sysv \
    firewalld \
    mysql-client 

# 确保 /sbin/init 指向 /lib/systemd/systemd
RUN ln -sf /lib/systemd/systemd /sbin/init

COPY ./systemctl /usr/bin/systemctl

RUN chmod +x /usr/bin/systemctl

VOLUME [ "/sys/fs/cgroup" ]

# 修复系统内可能存在的容器环境问题
RUN (cd /lib/systemd/system/sysinit.target.wants/; for i in *; do \
        [ "$i" = "systemd-tmpfiles-setup.service" ] || rm -f "$i"; \
    done); \
    rm -f /lib/systemd/system/multi-user.target.wants/*; \
    rm -f /etc/systemd/system/*.wants/*; \
    rm -f /lib/systemd/system/local-fs.target.wants/*; \
    rm -f /lib/systemd/system/sockets.target.wants/*udev*; \
    rm -f /lib/systemd/system/sockets.target.wants/*initctl*; \
    rm -f /lib/systemd/system/basic.target.wants/*; \
    rm -f /lib/systemd/system/anaconda.target.wants/*;

# 设置默认命令
CMD ["/bin/bash"]

``` 

2.  构建命令
    

```shell
docker build -t systemctl-client .
```

3.  启动命令
    

```shell
docker run -it  --user=root   --privileged   -v /run/systemd/private:/run/systemd/private   -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket   -v /sys/fs/cgroup:/sys/fs/cgroup   systemctl-client
```

4.  脚本（将脚本命名为systemctl，并放置在和Dockerfile同级的目录中，这个脚本文件支持systemctl status stop start restart命令）
    

```shell
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import dbus
import os
import time
from datetime import datetime

def get_bus():
    return dbus.SystemBus()

def get_manager(bus):
    systemd = bus.get_object('org.freedesktop.systemd1',
                             '/org/freedesktop/systemd1')
    return dbus.Interface(systemd, 'org.freedesktop.systemd1.Manager')

def get_unit_properties(bus, unit_name):
    manager = get_manager(bus)
    try:
        unit = manager.GetUnit(unit_name)
    except dbus.exceptions.DBusException:
        print(f"Unit {unit_name} could not be found.")
        sys.exit(1)
    unit_proxy = bus.get_object('org.freedesktop.systemd1', unit)
    return dbus.Interface(unit_proxy, 'org.freedesktop.DBus.Properties')

def format_time(timestamp):
    if timestamp == 0:
        return 'n/a'
    else:
        return datetime.fromtimestamp(timestamp / 1e6).strftime('%Y-%m-%d %H:%M:%S')

def show_status(unit_name):
    bus = get_bus()
    props = get_unit_properties(bus, unit_name)

    # 获取单元属性
    info = {}
    info['Id'] = props.Get('org.freedesktop.systemd1.Unit', 'Id')
    info['Description'] = props.Get('org.freedesktop.systemd1.Unit', 'Description')
    info['LoadState'] = props.Get('org.freedesktop.systemd1.Unit', 'LoadState')
    info['ActiveState'] = props.Get('org.freedesktop.systemd1.Unit', 'ActiveState')
    info['SubState'] = props.Get('org.freedesktop.systemd1.Unit', 'SubState')
    info['UnitFileState'] = props.Get('org.freedesktop.systemd1.Unit', 'UnitFileState')
    info['ExecMainPID'] = props.Get('org.freedesktop.systemd1.Service', 'ExecMainPID')
    info['ExecMainStatus'] = props.Get('org.freedesktop.systemd1.Service', 'ExecMainStatus')
    info['ExecMainStartTimestamp'] = props.Get('org.freedesktop.systemd1.Service', 'ExecMainStartTimestamp')

    # 格式化输出
    print(f"● {info['Id']} - {info['Description']}")
    print(f"   Loaded: {info['LoadState']} ({info['UnitFileState']}; vendor preset: enabled)")
    print(f"   Active: {info['ActiveState']} ({info['SubState']}) since {format_time(info['ExecMainStartTimestamp'])};")
    print(f" Main PID: {info['ExecMainPID']} (code=exited, status={info['ExecMainStatus']})")

    # 显示最近的日志（可选）
    print("\n日志输出（最近的5条）：")
    show_journal(unit_name)

def show_journal(unit_name, lines=5):
    # 由于无法直接通过 D-Bus 获取日志，这里调用 journalctl 命令
    cmd = f"journalctl -u {unit_name} -n {lines} --no-pager"
    os.system(cmd)

def control_service(unit_name, action):
    bus = get_bus()
    manager = get_manager(bus)
    try:
        if action == 'start':
            manager.StartUnit(unit_name, 'replace')
        elif action == 'stop':
            manager.StopUnit(unit_name, 'replace')
        elif action == 'restart':
            manager.RestartUnit(unit_name, 'replace')
        elif action == 'reload':
            manager.ReloadUnit(unit_name, 'replace')
        else:
            print(f"Unknown action: {action}")
            sys.exit(1)
        print(f"Successfully executed '{action}' on {unit_name}.")
    except dbus.exceptions.DBusException as e:
        error_message = e.get_dbus_message()
        print(f"Failed to {action} {unit_name}: {error_message}")
        sys.exit(1)

def main():
    if len(sys.argv) < 3:
        print("用法：python3 systemctl.py <命令> <服务名>")
        print("命令：start | stop | restart | status")
        sys.exit(1)

    action = sys.argv[1]
    unit_name = sys.argv[2]

    if not unit_name.endswith('.service'):
        unit_name += '.service'

    if action == 'status':
        show_status(unit_name)
    elif action in ['start', 'stop', 'restart', 'reload']:
        control_service(unit_name, action)
    else:
        print(f"未知的命令：{action}")
        sys.exit(1)

if __name__ == '__main__':
    main()

```

2.  修改代码，在代码中手动起停服务
    
3.  将容器分成两个，一个有systemd，运行程序；一个只有网络功能，将docker映射到第一个容器中，通过docker调用实现服务管理
    
4.  测试其他可能可行的方案
    
    1.  将宿主机的dbus映射到容器中的特定位置（测试过，暂未成功）
        

# 解决方案

systemd提供了一个api，可以编写python脚本实现和直接使用systemctl类似的功能

1.  Dockerfile文件（需要准备systemctl脚本文件，见下面第四步）
    

```shell
FROM ubuntu:24.10

ENV container docker

# 禁用交互安装
ENV DEBIAN_FRONTEND=noninteractive


# 更新包列表并安装所需的软件包
RUN  unset http_proxy && unset https_proxy && apt-get update -y && \
    apt-get install -y \
    iproute2 \
    iputils-ping \
    procps \
    telnet \
    pciutils \
    rpm \
    vim \
    kmod \
    policycoreutils \
    libpcre3 \
    libpcre3-dev \
    usbutils \
    gcc \
    g++ \
    gdb \
    snmp \
    openssh-client \
    chrony \
    tcpdump \
    keepalived \
    bc \
    selinux-policy-default \
    dbus \
    network-manager \
    systemd \
    systemd-sysv \
    firewalld \
    mysql-client 

# 确保 /sbin/init 指向 /lib/systemd/systemd
RUN ln -sf /lib/systemd/systemd /sbin/init

COPY ./systemctl /usr/bin/systemctl

RUN chmod +x /usr/bin/systemctl

VOLUME [ "/sys/fs/cgroup" ]

# 修复系统内可能存在的容器环境问题
RUN (cd /lib/systemd/system/sysinit.target.wants/; for i in *; do \
        [ "$i" = "systemd-tmpfiles-setup.service" ] || rm -f "$i"; \
    done); \
    rm -f /lib/systemd/system/multi-user.target.wants/*; \
    rm -f /etc/systemd/system/*.wants/*; \
    rm -f /lib/systemd/system/local-fs.target.wants/*; \
    rm -f /lib/systemd/system/sockets.target.wants/*udev*; \
    rm -f /lib/systemd/system/sockets.target.wants/*initctl*; \
    rm -f /lib/systemd/system/basic.target.wants/*; \
    rm -f /lib/systemd/system/anaconda.target.wants/*;

# 设置默认命令
CMD ["/bin/bash"]

```

2.  构建命令
    

```shell
docker build -t systemctl-client .
```

3.  启动命令
    

```shell
docker run -it  --user=root   --privileged   -v /run/systemd/private:/run/systemd/private   -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket   -v /sys/fs/cgroup:/sys/fs/cgroup -v /usr/bin/nmcli:/usr/bin/nmcli:ro  systemctl-client
```

4.  脚本（将脚本命名为systemctl，并放置在和Dockerfile同级的目录中，这个脚本文件支持systemctl status stop start restart命令）
    

```shell
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import dbus
import os
import time
from datetime import datetime

def get_bus():
    return dbus.SystemBus()

def get_manager(bus):
    systemd = bus.get_object('org.freedesktop.systemd1',
                             '/org/freedesktop/systemd1')
    return dbus.Interface(systemd, 'org.freedesktop.systemd1.Manager')

def get_unit_properties(bus, unit_name):
    manager = get_manager(bus)
    try:
        unit = manager.GetUnit(unit_name)
    except dbus.exceptions.DBusException:
        print(f"Unit {unit_name} could not be found.")
        sys.exit(1)
    unit_proxy = bus.get_object('org.freedesktop.systemd1', unit)
    return dbus.Interface(unit_proxy, 'org.freedesktop.DBus.Properties')

def format_time(timestamp):
    if timestamp == 0:
        return 'n/a'
    else:
        return datetime.fromtimestamp(timestamp / 1e6).strftime('%Y-%m-%d %H:%M:%S')

def show_status(unit_name):
    bus = get_bus()
    props = get_unit_properties(bus, unit_name)

    # 获取单元属性
    info = {}
    info['Id'] = props.Get('org.freedesktop.systemd1.Unit', 'Id')
    info['Description'] = props.Get('org.freedesktop.systemd1.Unit', 'Description')
    info['LoadState'] = props.Get('org.freedesktop.systemd1.Unit', 'LoadState')
    info['ActiveState'] = props.Get('org.freedesktop.systemd1.Unit', 'ActiveState')
    info['SubState'] = props.Get('org.freedesktop.systemd1.Unit', 'SubState')
    info['UnitFileState'] = props.Get('org.freedesktop.systemd1.Unit', 'UnitFileState')
    info['ExecMainPID'] = props.Get('org.freedesktop.systemd1.Service', 'ExecMainPID')
    info['ExecMainStatus'] = props.Get('org.freedesktop.systemd1.Service', 'ExecMainStatus')
    info['ExecMainStartTimestamp'] = props.Get('org.freedesktop.systemd1.Service', 'ExecMainStartTimestamp')

    # 格式化输出
    print(f"● {info['Id']} - {info['Description']}")
    print(f"   Loaded: {info['LoadState']} ({info['UnitFileState']}; vendor preset: enabled)")
    print(f"   Active: {info['ActiveState']} ({info['SubState']}) since {format_time(info['ExecMainStartTimestamp'])};")
    print(f" Main PID: {info['ExecMainPID']} (code=exited, status={info['ExecMainStatus']})")

    # 显示最近的日志（可选）
    print("\n日志输出（最近的5条）：")
    show_journal(unit_name)

def show_journal(unit_name, lines=5):
    # 由于无法直接通过 D-Bus 获取日志，这里调用 journalctl 命令
    cmd = f"journalctl -u {unit_name} -n {lines} --no-pager"
    os.system(cmd)

def control_service(unit_name, action):
    bus = get_bus()
    manager = get_manager(bus)
    try:
        if action == 'start':
            manager.StartUnit(unit_name, 'replace')
        elif action == 'stop':
            manager.StopUnit(unit_name, 'replace')
        elif action == 'restart':
            manager.RestartUnit(unit_name, 'replace')
        elif action == 'reload':
            manager.ReloadUnit(unit_name, 'replace')
        else:
            print(f"Unknown action: {action}")
            sys.exit(1)
        print(f"Successfully executed '{action}' on {unit_name}.")
    except dbus.exceptions.DBusException as e:
        error_message = e.get_dbus_message()
        print(f"Failed to {action} {unit_name}: {error_message}")
        sys.exit(1)

def main():
    if len(sys.argv) < 3:
        print("用法：python3 systemctl.py <命令> <服务名>")
        print("命令：start | stop | restart | status")
        sys.exit(1)

    action = sys.argv[1]
    unit_name = sys.argv[2]

    if not unit_name.endswith('.service'):
        unit_name += '.service'

    if action == 'status':
        show_status(unit_name)
    elif action in ['start', 'stop', 'restart', 'reload']:
        control_service(unit_name, action)
    else:
        print(f"未知的命令：{action}")
        sys.exit(1)

if __name__ == '__main__':
    main()

```

# 注意事项

1.  在容器中使用`nmcli`命令操作宿主机的网络时，可能会出现版本不一致的问题，可以在启动命令中加上
    

```shell
-v /usr/bin/nmcli:/usr/bin/nmcli:ro
```

将宿主机的nmcli命令映射到容器中

2.  systemd使用的是dbus进行进程间通讯（不管使用systemd命令还是上面的脚本），而上面的实现方式中将宿主机的dbus映射到了容器中，导致在容器中管理服务实际上是和外部宿主机是类似的，所以当需要在容器中管理某些服务时，需要确保外部的宿主机同样安装有对应的服务
    

root@c792b9cd0957:/# nmcli c modify eth0 ipv4.method manual  ipv4.addresses 192.168.5.112/24 ipv4.gateway '' ipv4.dns 11.11.11.11 ipv6.method disabled  ipv6.address ''

Error: Failed to modify connection 'eth0': ipv4.dns-data: ????