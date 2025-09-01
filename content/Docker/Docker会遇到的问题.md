# 端口占用

当容器设置了外部端口映射，在启动容器时报端口冲突，可能是由于Docker自身的问题（多次使用脚本重复安装Docker可能会出现），可以重启docker或者重启机器

# Mariadb启动失败

```shell
2024-10-10 02:34:17+00:00 [Note] [Entrypoint]: Entrypoint script for MariaDB Server 1:11.2.4+maria~ubu2204 started.
2024-10-10 02:34:17+00:00 [ERROR] [Entrypoint]: mariadbd failed while attempting to check config
        command was: mariadbd --verbose --help
        Warning: World-writable config file '/etc/mysql/mariadb.conf.d/99-custom.cnf' is ignored
Can't initialize timers
2024-10-10 02:50:08+00:00 [Note] [Entrypoint]: Entrypoint script for MariaDB Server 1:11.2.4+maria~ubu2204 started.
2024-10-10 02:50:08+00:00 [ERROR] [Entrypoint]: mariadbd failed while attempting to check config
        command was: mariadbd --verbose --help
        Warning: World-writable config file '/etc/mysql/mariadb.conf.d/99-custom.cnf' is ignored
Can't initialize timers
```

mariadb启动时报如上错误，~~可能是Docker配置问题导致的（和端口占用类似），可以尝试重启Docker解决~~

可能是docker版本的问题，在[docker二进制文件下载](https://download.docker.com/linux/static/stable/x86_64/)网站中下载最新的docker文件可以解决

# Docker容器启动失败

```shell
failed to create shim task: OCI runtime create failed: container_linux.go
```

Docker容器启动时报上面的错误，需要在docker-compose中的服务配置里添加上

```shell
security_opt:
      - seccomp:unconfined
```

# Nacos连接失败

nacos服务的服务名中不要带有特殊字符，根据 RFC 952 和 RFC 1123，主机名只能包含字母（A-Z，a-z）、数字（0-9）和连字符 `-`，但不能包含下划线 `_`。