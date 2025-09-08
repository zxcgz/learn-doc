# 一、准备工作（麒麟 V10 视作 EL8 系列）

1. 基础要求（建议，但不是硬性限制）
    

- 8 GB+ 内存（最低 4 GB 也能跑，但会非常吃紧）；磁盘尽量用 SSD。([docs.gitlab.com](https://docs.gitlab.com/install/requirements/?utm_source=chatgpt.com "GitLab installation requirements"))
    
- 防火墙开放 Web/SSH 端口（见下文命令）。
    
- 规划访问地址（域名或 IP），比如 `http://192.168.1.10:8888`。
    

2. 安装依赖 & 启用 SSH
    

```bash
sudo yum -y install curl policycoreutils-python-utils openssh-server perl
sudo systemctl enable --now sshd
```

（依赖写法与 EL8 相同，官方安装文档也是这样给的。([CSDN](https://blog.csdn.net/weixin_42235842/article/details/135694379?utm_source=chatgpt.com "第一章gitlab搭建原创"))）

> 注：极狐官网提示**如需麒麟适配安装包**可联系其支持；多数麒麟 V10 直接用 EL8 包即可，如遇到系统库不兼容再考虑官方适配包。([极狐GitLab](https://gitlab.cn/en/install/?utm_source=chatgpt.com "Download and install JiHu GitLab"))

---

# 二、下载并安装 15.11.2-jh 指定版本

> 极狐（JiHu）RPM 的命名规律：  
> `gitlab-jh-<版本>-jh.0.el8.<架构>.rpm`（例如 `gitlab-jh-17.7.0-jh.0.el8.x86_64.rpm`）。**把版本替换为 15.11.2 即可**：`gitlab-jh-15.11.2-jh.0.el8.x86_64.rpm`。下载域名为 `packages.gitlab.cn`。([极狐GitLab](https://gitlab.cn/resources/articles/713ced3d37e34774b9c36da1ee7bc942?utm_source=chatgpt.com "如何在CentOS Stream上安装极狐GitLab？"))

1)（下载）把下面的版本/架构改好就能直接拉包：

```bash
VER="15.11.2"
ARCH="x86_64"
curl -L -o gitlab-jh-${VER}-jh.0.el8.${ARCH}.rpm \
  "https://packages.gitlab.cn/repository/el/8/gitlab-jh-${VER}-jh.0.el8.${ARCH}.rpm"
```

（上面链接格式来自极狐官方文章示例，换版本号即可。若直连受限，可以浏览极狐站点或换国内镜像源获取同名文件。([极狐GitLab](https://gitlab.cn/resources/articles/713ced3d37e34774b9c36da1ee7bc942?utm_source=chatgpt.com "如何在CentOS Stream上安装极狐GitLab？")))

2)（安装 + 设置访问地址）  
`EXTERNAL_URL` 一次性写入配置，安装会自动据此生成 NGINX 配置：

```bash
export EXTERNAL_URL="http://<你的域名或IP>:<端口>"   #此处的配置不生效，可以在安装后修改配置实现
sudo rpm -ivh gitlab-jh-${VER}-jh.0.el8.${ARCH}.rpm
sudo gitlab-ctl reconfigure
sudo gitlab-ctl status
```

（Omnibus 的安装与 `gitlab-ctl reconfigure` 用法，见官方安装/运维文档。([about.gitlab.com](https://gitlab.com/gitlab-org/omnibus-gitlab/-/tree/16.6.2%2Bce.0/doc/installation?utm_source=chatgpt.com "doc/installation · 16.6.2+ce.0")))

3)（防火墙开放端口）

```bash
# 如果用 80/443/22
# sudo firewall-cmd --permanent --add-service=http
# sudo firewall-cmd --permanent --add-service=https
# sudo firewall-cmd --permanent --add-service=ssh
# 如果用自定义端口(如 8888)
sudo firewall-cmd --permanent --add-port=8888/tcp
sudo firewall-cmd --reload
```

（防火墙的开放示例同极狐安装指引。([CSDN](https://blog.csdn.net/weixin_42235842/article/details/135694379?utm_source=chatgpt.com "第一章gitlab搭建原创")))

4)（首次登录）  
浏览器访问 `EXTERNAL_URL`。初始管理员账号是 `root`，**初始密码在服务器**：

```bash
sudo cat /etc/gitlab/initial_root_password
```

（这个密码文件会在 24 小时后的首次 reconfigure 时自动清理，登录后尽快改密。([阿里云帮助中心](https://help.aliyun.com/zh/ecs/use-cases/deploy-and-use-gitlab?utm_source=chatgpt.com "部署GitLab代码托管平台_云服务器ECS(ECS) - 阿里云文档")))

---

# 三、固定版本，避免被升级覆盖

安装完可把版本“锁住”，防止后续误升级到其他 jh 版本：

```bash
sudo yum -y install yum-plugin-versionlock
sudo yum versionlock add gitlab-jh*
```

（后续想换版本：`versionlock delete gitlab-jh*`，然后下载目标版本 rpm 再 `rpm -Uvh` 即可。）

---

# 四、常用调优与改端口

- **改端口/域名**：编辑 `/etc/gitlab/gitlab.rb` 的 `external_url "http://host:port"`，然后：
    
    ```bash
    sudo gitlab-ctl reconfigure
    sudo gitlab-ctl restart
    ```
    
- **SELinux**：默认支持；若反向代理或需要外连服务被阻断，再按需添加布尔值或策略（`policycoreutils-python-utils` 已安装）。([CSDN](https://blog.csdn.net/weixin_42235842/article/details/135694379?utm_source=chatgpt.com "第一章gitlab搭建原创"))
    
- **内存吃紧**：参考“低内存环境”建议，配置适当的 swap（一般为内存的 ~50%），可明显缓解 OOM。([docs.gitlab.com](https://docs.gitlab.com/omnibus/settings/memory_constrained_envs/?utm_source=chatgpt.com "Running GitLab in a memory-constrained environment"))
    

---

# 五、已知版本注意事项（仅当以后升级时）

> **15.11.0～15.11.2** 存在一次数据库迁移“压缩”造成的**升级边界问题**。  
> 如果未来你要从 **15.11.0/1/2** 升到 **15.11.3+ 或 16.x**，需要按官方给的**迁移修复工作流**执行一次补救任务（GitLab 与极狐均有说明/合并请求记录），再做常规升级，否则可能报迁移冲突。([about.gitlab.com](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/121188?utm_source=chatgpt.com "Add task to fix migrations for 15.11 upgrades - Merge ..."), [JiHu GitLab](https://dev-ops.gitlab.cn/gitlab-cn/gitlab/-/tree/v15.11.11-jh/db?utm_source=chatgpt.com "db · v15.11.11-jh"))

---

# 六、故障排查速记

- 页面 502/无法访问：`sudo gitlab-ctl status && sudo gitlab-ctl tail` 看组件是否都起来；常见是端口占用或 `external_url` 不匹配。([about.gitlab.com](https://gitlab.com/gitlab-org/omnibus-gitlab/-/tree/16.6.2%2Bce.0/doc/installation?utm_source=chatgpt.com "doc/installation · 16.6.2+ce.0"))
    
- 无法登录：确认初始密码文件是否仍在（见上文）；如已清理可用 `gitlab-rake "gitlab:password:reset[root]"` 重置。([forum.gitlab.cn](https://forum.gitlab.cn/forum.php?mod=viewthread&tid=191&utm_source=chatgpt.com "gitlab初始密码"))
    

---

## 一键脚本（可直接复制执行）

> 把 `EXTERNAL_URL` 改成你的访问地址即可。

```bash
#!/usr/bin/env bash
set -euo pipefail

VER="15.11.2"
ARCH="x86_64"
EXTERNAL_URL="http://192.168.1.10:8888"

echo "[1/5] 安装依赖..."
sudo yum -y install curl policycoreutils-python-utils openssh-server perl
sudo systemctl enable --now sshd

echo "[2/5] 下载极狐 GitLab ${VER}-jh rpm..."
curl -L -o gitlab-jh-${VER}-jh.0.el8.${ARCH}.rpm \
  "https://packages.gitlab.cn/repository/el/8/gitlab-jh-${VER}-jh.0.el8.${ARCH}.rpm"

echo "[3/5] 安装并初始化..."
export EXTERNAL_URL="$EXTERNAL_URL"
sudo rpm -ivh gitlab-jh-${VER}-jh.0.el8.${ARCH}.rpm
sudo gitlab-ctl reconfigure

echo "[4/5] 开放防火墙端口(示例: 8888)..."
sudo firewall-cmd --permanent --add-port=$(echo $EXTERNAL_URL | awk -F: '{print $NF}')/tcp || true
sudo firewall-cmd --reload || true

echo "[5/5] 初始状态 & 管理员密码..."
sudo gitlab-ctl status
echo "root 初始密码："
sudo sed -n 's/^Password: //p' /etc/gitlab/initial_root_password || true

echo "完成。用浏览器打开：$EXTERNAL_URL （用户名 root）"
```

---

需要我帮你把 `EXTERNAL_URL`、端口、以及是否要启用 HTTPS（自签或真实证书）都配好，也可以直接说你的目标访问方式；我就给你生成对应的 `gitlab.rb` 片段和命令。