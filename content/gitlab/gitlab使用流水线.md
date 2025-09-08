
> [!注意] 注意
> 此处的内容针对 `15.11.2-jh`  版本

## 介绍
gitlab中的流水线对应github中的action，和github不同的是gitlab使用项目根目录下的./gitlab-ci.yml（可以在gitlab系统中配置这个文件名）进行设置，格式也有区别。  
gitlab的流水线运行在名为runner的环境中，runner可以运行在任何可以与gitlab服务相互通信的机器上，支持Linux、Windows、K8S、Docker 等环境 ，根据教程安装并设置好后就可以在gitlab中识别并根据配置进行分配。 
**需要注意的是，runner可以运行在docker中，也可以在linux中使用docker运行**

## 安装Runner
安装runner前需要获取gitlab的相关配置，以使两者可以建立关联。  
gitlab中的runner分为三种：项目、群组、实例。实例runner可以被整个gitlab中的所有项目使用，群组runner可以被群组中的所有项目使用，项目runner只能作用于设置的项目。  根据需要进行选择。  
### 实例Runner
实例runner的相关配置在`管理中心 - CI/CD - Runner - 注册一个实例Runner` 中，点击显示runner安装和注册说明就可以看到相关文档，按照文档安装部署即可。  
### 群组Runner
