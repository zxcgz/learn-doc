# sealos部署文档

#  Sealos部署

## 环境说明

使用VMware启动四台Ubuntu 22的虚拟机，配置仅主机模式的网络，所有虚拟机之间可以相互通信，但是都无法访问互联网，来模拟离线环境。

四台虚拟机分别被命名为master01、master02、worker01、worker02，来模拟集群节点。

四台虚拟机上设置相同的root密码，本次文档中使用的是sinocipher。

四台虚拟机上安装ssh-server（使用的ubuntu桌面版，默认没有ssh服务端），并配置默认端口号和允许root登录。

四台机器的ip分别为：

*   master01：192.168.20.128
    
*   master02：192.168.20.129
    
*   worker01：192.168.20.130
    
*   worker02：192.168.20.131
    

## 资源准备

资源准备阶段需要在一台可以联网的机器上进行，并且需要是linux机器

1.  从sealos的[官方仓库](https://github.com/labring/sealos/releases/tag/v5.0.0)中下载安装包，文档中使用的是v5.0.0版本。
    
2.  在联网机器上安装sealos（sealos只能安装在linux环境中）
    
3.  使用联网机器打包镜像
    
    1.  打包k8s
        
        1.  根据机器的网络环境选择`sealos pull registry.cn-shanghai.aliyuncs.com/labring/kubernetes:v1.28.11`或者`sealos pull labring/kubernetes:v1.28.11`命令进行下载
            
        2.  根据下载命令选择`sealos save -o kubernetes.tar registry.cn-shanghai.aliyuncs.com/labring/kubernetes:v1.28.11`或者`sealos save -o kubernetes.tar labring/kubernetes:v1.28.11`打包成tar文件
            
    2.  打包helm
        
        1.  和打包k8s相同，镜像tag替换成`labring/helm:v3.14.0`，打包文件名替换成helm.tar即可
            
    3.  打包calico
        
        1.  和打包k8s相同，镜像tag替换成`labring/calico:3.26.4`，打包文件名替换成calico.tar即可
            
4.  将sealos安装包和打包好的k8s、helm、calico镜像上传到master01中
    

将sealos安装包和打包好的k8s上传到master01上

## k8s部署

使用root账户登录master01节点。

执行相应命令安装sealos，在ubuntu中为`dpkg -i sealos.deb`，执行sealos验证是否成功。

将上传上来的k8s、helm、calico镜像tar包复制到一个目录中，比如`~/sealos`执行命令

```shell
sealos run kubernetes.tar helm.tar calico.tar  --masters 192.168.20.128,192.168.20.129 --nodes 192.168.20.130,192.168.20.131 -p sinocipher
```

运行完成后，根据提示，如果使用普通用户进行后续集群管理，执行

```shell
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

如果要使用root进行后续集群管理，执行

```shell
export KUBECONFIG=/etc/kubernetes/admin.conf
```

执行

```shell
kubectl get nodes
```

查看节点状态，如果出现四个节点，且STATUS都为Ready则部署成功行

## 注意

1.  测试环境中使用的是root权限进行安装，如果使用非root权限安装可能会需要额外安装两个依赖
    
2.  需要保证所有的节点都可以相互使用root账户进行ssh访问，并且root账户密码要相同
    
3.  安装命令中三个tar包的顺序不要颠倒
    

# 离线部署Kuboard

在sealos部署好的k8s集群上离线部署Kuboard

## 环境说明

使用上面sealos部署时相同的物理环境，且联网机器上安装有docker（暂未测试使用sealos是否可行），部署操作在master01节点上完成

## 资源准备

此次部署使用的是kuboard中[static pod](https://kuboard.cn/install/v3/install-static-pod.html#static-pod-%E5%AE%89%E8%A3%85-kuboard)的安装方式，（[k8s](https://kuboard.cn/install/v3/install-in-k8s.html)方式没有安装成功）

### 准备脚本

同样准备一台能联网的机器，执行

```sh
curl -fsSL https://addons.kuboard.cn/kuboard/kuboard-static-pod.sh -o kuboard.sh
```

命令下载脚本。

#### 修改ip获取逻辑

打开脚本，找到

```shell
ipaddr=$(ip addr | awk '/^[0-9]+: / {}; /inet.*global/ {print gensub(/(.*)\/(.*)/, "\1", "g", $2)}' | awk 'NR==1{print}')
```

这样代码，复制其中的

```shell
ip addr | awk '/^[0-9]+: / {}; /inet.*global/ {print gensub(/(.*)\/(.*)/, "\1", "g", $2)}' | awk 'NR==1{print}'
```

到master01节点上执行，如果执行没有结果，则使用

```shell
ip addr | awk '/inet.*global/ {sub(/\/.*$/, "", $2); print $2}' | head -n 1
```

命令尝试，如果有ip输出，则修改脚本的相关内容并保存

#### 修改镜像名

此步骤不是必须的，只要和下面镜像打包操作相对应即可，此处的内容是由于使用[k8s](https://kuboard.cn/install/v3/install-in-k8s.html)方式安装测试时遗留的步骤（使用k8s离线安装时，官方文档中将镜像tag做了重命名，此处是沿用了重命名后的名字）

找到脚本中

```shell
      image: 'eipwork/kuboard:v3'
```

部分，替换成

```java
      image: 'registry.mycompany.com/kuboard/kuboard:v3'
```

并保存。

### 准备镜像文件

#### 下载镜像

在联网机器上执行命令

```java
docker pull eipwork/kuboard:v3
```

下载镜像

#### tag

如果在**准备脚本**步骤中修改了镜像名，则需要执行此步骤，否则跳过

执行命令

```shell
docker tag eipwork/kuboard:v3 registry.mycompany.com/kuboard/kuboard:v3
```

给下载的docker镜像打上需要的tag

#### 打包镜像

根据上一步的执行情况，选择下面的命令，进行打包镜像操作

```shell
docker save -o kuboard.tar registry.mycompany.com/kuboard/kuboard:v3
#或
docker save -o kuboard.tar eipwork/kuboard:v3
```

### 加载镜像

由于k8s新版本不再使用docker作为默认容器，所以环境中可能没有docker

#### 存在docker

如果master01节点中存在docker则执行

```shell
docker load -i kuboard.tar
```

命令加载镜像，使用

```shell
docker images
```

命令查看是否存在打包镜像时的镜像名，检查是否加载成功。

#### 没有docker

master01节点中没有docker时，需要将镜像导入Containerd中，执行

```shell
ctr -n=k8s.io images import kuboard.tar
```

命令加载镜像，使用

```shell
ctr -n=k8s.io images ls
```

命令查看是否存在打包镜像时的镜像名，检查是否加载成功。

## Kuboard部署

进入下载的kuboard.sh脚本所在的目录，执行

```shell
sh kuboard.sh
```

命令进行自动安装

安装完成后执行

```shell
kubectl get pods -n kuboard -o wide
```

命令，查看Status是否为Ready，检查是否运行成功

运行成功后则可以通过http://192.168.20.128 访问 kuboard 界面（此信息会出现在脚本执行结果中）

## 注意

### 卸载

当安装失败或者想要删除时，依次执行下面命令即可

```shell
kubectl delete -f /root/kuboard-sa.yaml
rm -rf /root/kuboard-sa.yaml
```