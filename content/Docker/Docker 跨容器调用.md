当容器A需要调用容器B的命令，又不希望在两个容器中额外部署更多的服务或添加更多的文件，可以使用将宿主机的docker映射到容器A的方式

```shell
docker run --name web --privileged -v /etc/localtime:/etc/localtime:ro -v /var/run/docker.sock:/var/run/docker.sock -v /usr/bin/docker:/usr/bin/docker -d -p 8080:8080  tomcat:8.5.35
```

进入启动的容器，可以执行docker命令看到宿主机启动的容器，进而使用

```shell
 docker exec 其他容器 /bin/bash -c 'cd /packages/detectron && python tools/train.py'
```

类似的命令调用执行其他容器中的命令

# 注意事项

1.  容器A需要明确知道容器B的服务名，否则使用命令可能无法连接并调用容器B中的命令
    
2.  容器A需要和宿主机架构相同
    
3.  宿主机上安装的docker需要是静态版本，如果宿主机上的docker使用动态链接的方式连接了类似glibc之类的库，在容器A中执行docker命令时，会报`bash: /usr/bin/docker: cannot execute: required file not found`错误（现在1panel的安装方式中的docker是能实现跨容器调用的）
    
4.  （存疑）不同的系统镜像可能会有不同，可能存在某些系统镜像由于系统版本不同等问题导致调用失败