# Helm部署协同签名

使用Helm部署协同签名服务

# 安装Helm

Helm安装参考[官网文档](https://helm.sh/docs/intro/install/#from-the-binary-releases)，下载二进制文件并复制到指定目录，或者使用脚本进行安装

---

# 本地文件部署

---

## Minikube环境

### 环境配置

*   minikube version: v1.33.1
    
*   kubectl
    
    *   Client Version: v1.30.3
        
    *   Kustomize Version: v5.0.4-0.20230601165947-6ce0bf390ce3
        
    *   Server Version: v1.30.0
        
*   Ubuntu 22.04.4 LTS
    
*   helm
    
    *   version.BuildInfo{Version:"v3.15.3", GitCommit:"3bb50bbbdd9c946ba9989fbe4fb4104766302a64", GitTreeState:"clean", GoVersion:"go1.22.5"}
        

### 环境准备

1.  启动minikube`minikube start`
    
2.  在一个目录中执行`helm create cosign`并进入`cosign`目录
    

### 配置文件

#### values.yaml

```yaml
cosign_db:
  image:
    repository: 192.168.7.114/zhang/cosign_db
    tag: v1.0
  service:
    name: mysql-service
    type: ClusterIP
    port: 3306
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}

cosign_java:
  image:
    repository: 192.168.7.114/zhang/cosign_java # 此处使用的
    tag: v1.2
  service:
    type: NodePort  # 修改为NodePort
    port: 9005
    targetPort: 9005
    nodePort: 30005  # 指定外部访问端口（可选）

  db:
    host: mysql-service
    port: 3306
    name: cosign_db
    user: root
    password: password
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}

network:
  subnet: "172.21.0.0/16"

service:
  type: ClusterIP

serviceAccount:
  create: false
ingress:
  enabled: false

autoscaling:
  enabled: false
```

#### templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mysql-service
  template:
    metadata:
      labels:
        app: mysql-service
    spec:
      containers:
        - name: mysql-service
          image: "{{ .Values.cosign_db.image.repository }}:{{ .Values.cosign_db.image.tag }}"
          ports:
            - containerPort: 3306
          volumeMounts:
            - mountPath: /var/lib/mysql
              name: db-data
      volumes:
        - name: db-data
          emptyDir: {}

---

apiVersion: apps/v1
kind: Deployment
metadata:
  name: cosign-java
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cosign-java
  template:
    metadata:
      labels:
        app: cosign-java
    spec:
      containers:
        - name: cosign-java
          image: "{{ .Values.cosign_java.image.repository }}:{{ .Values.cosign_java.image.tag }}"
          ports:
            - containerPort: {{ .Values.cosign_java.service.targetPort }}
          env:
            - name: DB_HOST
              value: "{{ .Values.cosign_java.db.host }}"
            - name: DB_PORT
              value: "{{ .Values.cosign_java.db.port }}"
            - name: DB_NAME
              value: "{{ .Values.cosign_java.db.name }}"
            - name: DB_USER
              value: "{{ .Values.cosign_java.db.user }}"
            - name: DB_PASSWORD
              value: "{{ .Values.cosign_java.db.password }}"
      restartPolicy: Always

```

#### templates/service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-service
spec:
  selector:
    app: mysql-service
  ports:
    - protocol: TCP
      port: {{ .Values.cosign_db.service.port }}
      targetPort: 3306
  type: {{ .Values.cosign_db.service.type }}

---

apiVersion: v1
kind: Service
metadata:
  name: cosign-java
spec:
  selector:
    app: cosign-java
  ports:
    - protocol: TCP
      port: {{ .Values.cosign_java.service.port }}
      targetPort: {{ .Values.cosign_java.service.targetPort }}
      nodePort: {{ .Values.cosign_java.service.nodePort }}
  type: {{ .Values.cosign_java.service.type }}

```

#### 证书配置

*    将证书添加到信任存储
    

*   linux  
    将自签名证书放在`/usr/local/share/ca-certificates/`并执行`update-ca-certificates`命令更新证书
    
*   windows
    
*   配置跳过TLS验证（不推荐，但方便）
    
*   编辑 Docker 守护进程的配置`/etc/docker/daemon.json`，添加
    

```java
{
  "insecure-registries" : ["192.168.7.114"]
}
```

*   重启docker
    

#### 启动服务

在`cosign`目录中执行`helm install cosign  ./`启动服务

#### 管理服务

1.  查看信息~~“服务名”~~（~~在k8s中应该是pods名~~）  
    `kubectl describe pods -l app`查看比较详细的信息  
    `kubectl get pods -l app`仅获取列表
    
2.  查看用于访问的url  
    `minikube service cosign-java --url`使用显示的url进行本机访问
    
3.  查看日志  
    `kubectl logs -f <服务名>`和docker不同，不支持`-n`参数
    
4.  进入容器  
    `kubectl exec -it <服务名> /bin/bash`
    
5.  不进入容器执行命令  
    `kubectl exec  <服务名> -- curl mysql-service:3306`
    
6.  删除服务  
    `helm uninstall cosign`
    

---

## k8s环境

### 环境配置

*   Ubuntu 22.04.2 LTS
    
*   kubectl
    
    *   Client Version: version.Info{Major:"1", Minor:"26", GitVersion:"v1.26.4", GitCommit:"f89670c3aa4059d6999cb42e23ccb4f0b9a03979", GitTreeState:"clean", BuildDate:"2023-04-12T12:13:53Z", GoVersion:"go1.19.8", Compiler:"gc", Platform:"linux/amd64"}
        
    *   Kustomize Version: v4.5.7
        
    *   Server Version: version.Info{Major:"1", Minor:"26", GitVersion:"v1.26.4", GitCommit:"f89670c3aa4059d6999cb42e23ccb4f0b9a03979", GitTreeState:"clean", BuildDate:"2023-04-12T12:05:35Z", GoVersion:"go1.19.8", Compiler:"gc", Platform:"linux/amd64"}
        
*   Helm
    
    *   version.BuildInfo{Version:"v3.14.4", GitCommit:"81c902a123462fd4052bc5e9aa9c513c4c8fc142", GitTreeState:"clean", GoVersion:"go1.21.9"}
        

### 集群配置

集群中包含两个节点，192.168.7.94为master节点，192.168.7.95为worker节点，helm安装在master节点上，且两个节点上没有docker服务（使用OCI）

### 环境准备

在master节点的一个目录中执行`helm create cosign`并进入`cosign`目录

### 配置文件

进入`cosign`目录后修改目录中的配置文件如下

#### values.yaml

```yaml
cosign_db:
  image:
    repository: 192.168.7.114/zhang/cosign_db
    tag: v1.0
  service:
    name: mysql-service
    type: ClusterIP
    port: 3306
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}

cosign_java:
  image:
    repository: 192.168.7.114/zhang/cosign_java # 此处使用的
    tag: v1.2
  service:
    type: NodePort  # 修改为NodePort
    port: 9005
    targetPort: 9005
    nodePort: 30005  # 指定外部访问端口（可选）

  db:
    host: mysql-service
    port: 3306
    name: cosign_db
    user: root
    password: password
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}

network:
  subnet: "172.21.0.0/16"

service:
  type: ClusterIP

serviceAccount:
  create: false
ingress:
  enabled: false

autoscaling:
  enabled: false
```

#### templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mysql-service
  template:
    metadata:
      labels:
        app: mysql-service
    spec:
      containers:
        - name: mysql-service
          image: "{{ .Values.cosign_db.image.repository }}:{{ .Values.cosign_db.image.tag }}"
          ports:
            - containerPort: 3306
          volumeMounts:
            - mountPath: /var/lib/mysql
              name: db-data
      volumes:
        - name: db-data
          emptyDir: {}

---

apiVersion: apps/v1
kind: Deployment
metadata:
  name: cosign-java
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cosign-java
  template:
    metadata:
      labels:
        app: cosign-java
    spec:
      containers:
        - name: cosign-java
          image: "{{ .Values.cosign_java.image.repository }}:{{ .Values.cosign_java.image.tag }}"
          ports:
            - containerPort: {{ .Values.cosign_java.service.targetPort }}
          env:
            - name: DB_HOST
              value: "{{ .Values.cosign_java.db.host }}"
            - name: DB_PORT
              value: "{{ .Values.cosign_java.db.port }}"
            - name: DB_NAME
              value: "{{ .Values.cosign_java.db.name }}"
            - name: DB_USER
              value: "{{ .Values.cosign_java.db.user }}"
            - name: DB_PASSWORD
              value: "{{ .Values.cosign_java.db.password }}"
      restartPolicy: Always

```

#### templates/service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-service
spec:
  selector:
    app: mysql-service
  ports:
    - protocol: TCP
      port: {{ .Values.cosign_db.service.port }}
      targetPort: 3306
  type: {{ .Values.cosign_db.service.type }}

---

apiVersion: v1
kind: Service
metadata:
  name: cosign-java
spec:
  selector:
    app: cosign-java
  ports:
    - protocol: TCP
      port: {{ .Values.cosign_java.service.port }}
      targetPort: {{ .Values.cosign_java.service.targetPort }}
      nodePort: {{ .Values.cosign_java.service.nodePort }}
  type: {{ .Values.cosign_java.service.type }}

```

### 证书配置

*   在正式的k8s中，如果安装的k8s版本比较高（1.20以上）时，会使用默认的Containerd作为其运行时环境，可能没有docker
    
    *   编辑`/etc/containerd/config.toml`配置文件，添加
        

```toml
[plugins."io.containerd.grpc.v1.cri".registry.configs."REGISTRY_DOMAIN:PORT".tls]
  ca_file = "/path/to/your/ca.crt"
  cert_file = "/path/to/your/client.cert"
  key_file = "/path/to/your/client.key"
```

*   重启Containerd
    

```shell
systemctl restart Containerd
#systemctl restart containerd
```

### 启动服务

在`cosign`目录中执行`helm install cosign  ./`启动服务

### 访问服务

使用任一节点的ip加30005端口号访问，如`https://192.168.7.95:30005`

### 管理服务

1.  查看信息~~“服务名”~~（~~在k8s中应该是pods名~~）  
    `kubectl describe pods -l app`查看比较详细的信息  
    `kubectl get pods -l app`仅获取列表
    
2.  查看日志  
    `kubectl logs -f <服务名>`和docker不同，不支持`-n`参数
    
3.  进入容器  
    `kubectl exec -it <服务名> /bin/bash`
    
4.  不进入容器执行命令  
    `kubectl exec  <服务名> -- curl mysql-service:3306`
    
5.  停止服务  
    `helm uninstall cosign`
    

---

# 仓库部署

将Helm需要的Charts打包上传到仓库中，然后配置仓库进行部署

## 仓库搭建

仓库使用[ChartMuseum](https://chartmuseum.com/)，这是专门用来做Helm仓库的工具，支持多种部署方式，本次部署使用的是Docker，并使用本地存储

1.  创建存储目录`mkdir /opt/chartmuseum/charts/`
    
2.  在`/opt/chartmuseum/`目录中执行docker命令
    

```shell
docker run --rm -it -d  -p 8081:8080  \
  -e DEBUG=1      \
  -e STORAGE=local      \
  -e STORAGE_LOCAL_ROOTDIR=/charts      \
  -v $(pwd)/charts:/charts     \
  chartmuseum/chartmuseum:latest
```

执行上面的命令就可以将charts目录作为Helm仓库的存储目录，并监听8081端口

## 上传Charts

上传操作在本地或开发环境中进行，将设置好的项目打包上传到仓库中

1.  进入创建的Helm项目目录中
    
2.  执行打包命令`helm package .`这个命令会在当前目录生成一个tgz文件
    
3.  执行上传命令，将tgz文件上传到仓库中`curl --data-binary "@mychart-0.1.0.tgz" http://192.168.7.114:8081/api/charts`，需要注意的是，文件名可以不用加引号，但前面一定要加**@**符号，否则会上传失败
    

## 设置Helm

设置操作在正式的部署环境中进行，设置用于正式部署的Helm的仓库

1.  执行添加命令，将仓库url添加到Helm中 `helm repo add private http://192.168.7.114:8081`
    
2.  执行更新命令，`helm repo update`
    
3.  执行搜索命令，检查是否设置成功，`helm search repo cosign`
    

## 部署

完成设置步骤后，就可以使用仓库中的Charts进行部署

1.  执行搜索命令，找到需要部署的名称 `helm search repo cosign`
    
2.  执行安装命令，安装需要的服务 `helm install cosign private/cosign_new`
    

### 管理服务

部署成功后，可以对服务进行管理，管理方式根据部署的环境参考前文使用minukube和k8s部署的内容

---

# 部署多副本

## 环境配置

和k8s部署相同

## 集群配置

和k8s部署相同

## 环境准备

和k8s部署相同

## 配置文件

进入`cosign`目录后修改目录中的配置文件如下

### values.yaml

size: 10Gi #此处的配置指定存储空间

```yaml
cosign_db:
  replicaCount: 3 #此配置用于指定副本数量
  image:
    repository: 192.168.7.114/zhang/cosign_db
    tag: v1.0
  service:
    name: mysql-service
    type: ClusterIP
    port: 3306
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}
  storage:
    size: 10Gi #此处的配置指定存储空间


cosign_java:
  replicaCount: 3 #此配置用于指定副本数量
  image:
    repository: 192.168.7.114/zhang/cosign_java # 此处使用的
    tag: v1.2
  service:
    type: NodePort  # 修改为NodePort
    port: 9005
    targetPort: 9005
    nodePort: 30005  # 指定外部访问端口（可选）

  db:
    host: mysql-service
    port: 3306
    name: cosign_db
    user: root
    password: password
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}

network:
  subnet: "172.21.0.0/16"

service:
  type: ClusterIP

serviceAccount:
  create: false
ingress:
  enabled: false

autoscaling:
  enabled: false
```

### templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql-service
spec:
  replicas: {{ .Values.cosign_db.replicaCount }} #此处引用value.yaml中的配置
  selector:
    matchLabels:
      app: mysql-service
  template:
    metadata:
      labels:
        app: mysql-service
    spec:
      containers:
        - name: mysql-service
          image: "{{ .Values.cosign_db.image.repository }}:{{ .Values.cosign_db.image.tag }}"
          ports:
            - containerPort: 3306
          volumeMounts:
            - mountPath: /var/lib/mysql
              name: db-data
      volumes:
        - name: db-data
          emptyDir: {}

---

apiVersion: apps/v1
kind: Deployment
metadata:
  name: cosign-java
spec:
  replicas: {{ .Values.cosign_java.replicaCount }} #此处引用value.yaml中的配置
  selector:
    matchLabels:
      app: cosign-java
  template:
    metadata:
      labels:
        app: cosign-java
    spec:
      containers:
        - name: cosign-java
          image: "{{ .Values.cosign_java.image.repository }}:{{ .Values.cosign_java.image.tag }}"
          ports:
            - containerPort: {{ .Values.cosign_java.service.targetPort }}
          env:
            - name: DB_HOST
              value: "{{ .Values.cosign_java.db.host }}"
            - name: DB_PORT
              value: "{{ .Values.cosign_java.db.port }}"
            - name: DB_NAME
              value: "{{ .Values.cosign_java.db.name }}"
            - name: DB_USER
              value: "{{ .Values.cosign_java.db.user }}"
            - name: DB_PASSWORD
              value: "{{ .Values.cosign_java.db.password }}"
      restartPolicy: Always

```

### templates/service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-service
spec:
  selector:
    app: mysql-service
  ports:
    - protocol: TCP
      port: {{ .Values.cosign_db.service.port }}
      targetPort: 3306
  type: {{ .Values.cosign_db.service.type }}

---

apiVersion: v1
kind: Service
metadata:
  name: cosign-java
spec:
  selector:
    app: cosign-java
  ports:
    - protocol: TCP
      port: {{ .Values.cosign_java.service.port }}
      targetPort: {{ .Values.cosign_java.service.targetPort }}
      nodePort: {{ .Values.cosign_java.service.nodePort }}
  type: {{ .Values.cosign_java.service.type }}

```

### templates/pvc.yaml

在templates目录中创建pvc.yaml文件

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-pvc
spec:
  accessModes:
    - ReadWriteOnce # 这个访问模式表示该卷可以被一个节点以读写的方式挂载。
  resources:
    requests:
      storage: {{ .Values.cosign_db.storage.size }} # 此处引用value.yaml中的配置

```

这个文件定义了一个 PVC，它主要用于存储 MySQL 数据库的数据。这样，即使数据库的 Pod 被重新调度到另一个节点上，数据也可以保持持久化

## 证书配置

和k8s部署相同，需要格外注意的是，在多副本配置中，pod可能会被分配给任一节点，所以需要在所有节点上配置证书，否则会出现部分节点pull镜像失败的问题

## 启动服务

和k8s部署相同

## 访问服务

和k8s部署相同

## 管理服务

和k8s部署相同

## 注意事项

1.  需要注意证书配置问题
    
2.  多副本情况下，java服务连接mysql需要更长的时间，需要等待连接成功才能正常访问
    

---

# 部署自动伸缩

根据配置可以成功启动，但是未测试是否可以正常自动伸缩

## 环境配置

和k8s部署相同

## 集群配置

和k8s部署相同

## 环境准备

和k8s部署相同

## 配置文件

进入`cosign`目录后修改目录中的配置文件如下

### values.yaml

size: 10Gi #此处的配置指定存储空间

```yaml
cosign_db:
  replicaCount: 3 #此配置用于指定副本数量
  image:
    repository: 192.168.7.114/zhang/cosign_db
    tag: v1.0
  service:
    name: mysql-service
    type: ClusterIP
    port: 3306
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}
  storage:
    size: 10Gi #此处的配置指定存储空间


cosign_java:
  replicaCount: 3 #此配置用于指定副本数量
  image:
    repository: 192.168.7.114/zhang/cosign_java # 此处使用的
    tag: v1.2
  service:
    type: NodePort  # 修改为NodePort
    port: 9005
    targetPort: 9005
    nodePort: 30005  # 指定外部访问端口（可选）

  db:
    host: mysql-service
    port: 3306
    name: cosign_db
    user: root
    password: password
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}

network:
  subnet: "172.21.0.0/16"

service:
  type: ClusterIP

serviceAccount:
  create: false
ingress:
  enabled: false

autoscaling: # 配置自动伸缩
  enabled: true
  minReplicas: 1
  maxReplicas: 2
  targetCPUUtilizationPercentage: 80

```

### templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql-service
spec:
  replicas: {{ .Values.cosign_db.replicaCount }} #此处引用value.yaml中的配置
  selector:
    matchLabels:
      app: mysql-service
  template:
    metadata:
      labels:
        app: mysql-service
    spec:
      containers:
        - name: mysql-service
          image: "{{ .Values.cosign_db.image.repository }}:{{ .Values.cosign_db.image.tag }}"
          ports:
            - containerPort: 3306
          volumeMounts:
            - mountPath: /var/lib/mysql
              name: db-data
      volumes:
        - name: db-data
          emptyDir: {}

---

apiVersion: apps/v1
kind: Deployment
metadata:
  name: cosign-java
spec:
  replicas: {{ .Values.cosign_java.replicaCount }} #此处引用value.yaml中的配置
  selector:
    matchLabels:
      app: cosign-java
  template:
    metadata:
      labels:
        app: cosign-java
    spec:
      containers:
        - name: cosign-java
          image: "{{ .Values.cosign_java.image.repository }}:{{ .Values.cosign_java.image.tag }}"
          ports:
            - containerPort: {{ .Values.cosign_java.service.targetPort }}
          env:
            - name: DB_HOST
              value: "{{ .Values.cosign_java.db.host }}"
            - name: DB_PORT
              value: "{{ .Values.cosign_java.db.port }}"
            - name: DB_NAME
              value: "{{ .Values.cosign_java.db.name }}"
            - name: DB_USER
              value: "{{ .Values.cosign_java.db.user }}"
            - name: DB_PASSWORD
              value: "{{ .Values.cosign_java.db.password }}"
      restartPolicy: Always

```

### templates/service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-service
spec:
  selector:
    app: mysql-service
  ports:
    - protocol: TCP
      port: {{ .Values.cosign_db.service.port }}
      targetPort: 3306
  type: {{ .Values.cosign_db.service.type }}

---

apiVersion: v1
kind: Service
metadata:
  name: cosign-java
spec:
  selector:
    app: cosign-java
  ports:
    - protocol: TCP
      port: {{ .Values.cosign_java.service.port }}
      targetPort: {{ .Values.cosign_java.service.targetPort }}
      nodePort: {{ .Values.cosign_java.service.nodePort }}
  type: {{ .Values.cosign_java.service.type }}

```

### templates/\_helpers.tpl

编辑\_helpers.tpl文件，在前面加上

```java
{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "chart.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | replace "_" "-" | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- $name = $name | replace "_" "-" -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | replace "_" "-" | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | replace "_" "-" | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}
```

### templates/hpa.yaml

创建并打开templates/hpa.yaml文件，添加内容

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "chart.fullname" . }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "chart.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
```

## 证书配置

和k8s部署相同，需要格外注意的是，在多副本的情况下配置中，pod可能会被分配给任一节点，所以需要在所有节点上配置证书，否则会出现部分节点pull镜像失败的问题

## 启动服务

和k8s部署相同

## 访问服务

和k8s部署相同

## 管理服务

和k8s部署相同

## 注意事项

1.  自动伸缩未能测试是否真的会在需要时对服务进行伸缩
    

---

# 网络配置