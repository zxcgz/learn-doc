# 用 Cloudflare Tunnel 把内网 GitLab / SonarQube / Mattermost 安全暴露到公网（Windows 实战）

> 适用读者：和我一样没有公网 IP，但想把 **GitLab / SonarQube / Mattermost** 暴露给公网访问，同时集成 **GitHub**、**OAuth**、**Webhook** 等；操作系统是 **Windows**。  
> 重点：**Cloudflare Tunnel（cloudflared）+ Zero Trust（按路径放行 OAuth/Webhook）+ 仅对 cloudflared 进程生效的代理**。  
> 本文整理了最终落地方案、为何这么做、全套配置与常用操作 / 排错清单，可直接复用。

---

## 0. 目标与约束

- **一台内网机器（Windows）** 同时部署：
    
    - GitLab：`http://localhost:8089`
        
    - SonarQube：`http://localhost:9000`
        
    - Mattermost：`http://localhost:8065`
        
- 公网用自定义域名访问（示例）：
    
    - `https://gitlab.kakitomeru.link`
        
    - `https://sonar.kakitomeru.link`
        
    - `https://chat.kakitomeru.link`
        
- **没有公网 IP**，出网受限，**访问 Cloudflare 必须走本机代理 `127.0.0.1:9910`**，但**不想设系统全局代理**。
    
- 需要集成：
    
    - Mattermost ↔ GitLab（OAuth）
        
    - Mattermost ↔ GitHub（OAuth + Webhook + 频道订阅）
        
- 通过 Cloudflare Zero Trust（Access）**仅对敏感路径做精细控制**（对 OAuth / Webhook **按路径 Bypass**，其余照常受保护/或不开保护）。
    

---

## 1. 方案选型与理由

为什么选择 **Cloudflare Tunnel**：

- **无需公网 IP / 端口映射**：内网到 Cloudflare 的**出站**连接即可建立公网入口。
    
- **多服务多域名**：一条隧道里用 `ingress` 把不同 hostname 路由到本机端口。
    
- **和 Zero Trust 配合**：**按路径**对 OAuth / Webhook **放行**，其它路径仍可保护（或完全不启用 Access）。
    
- **成本**：隧道与 Access 的基础能力**免费**可用；非常适合个人 / 小团队自建。
    

为什么 **仅对 cloudflared 进程设置代理**：

- 机器环境受限（需要代理），但**不希望全局代理**影响 GitLab/Sonar/Mattermost 或其他程序。
    
- 通过 **计划任务/服务** 启动 cloudflared 之前，**在脚本里临时设置 `HTTP[S]_PROXY`**，只对该进程生效。
    

为什么 **按路径放行** OAuth / Webhook：

- OAuth 回调与 Webhook 是**第三方平台主动访问我**的站点端点（GitHub/GitLab/Mattermost 插件）。
    
- 如果整站都走 Access 登录墙，会**拦住**这类回调/Webhook。
    
- 只需**放行极少数固定路径**（如 `/oauth/*`、`/plugins/.../oauth/complete`、`/plugins/.../webhook`），**安全与可用性兼顾**。
    

---

## 2. Cloudflare Tunnel：Windows 安装与配置

### 2.1 安装 cloudflared

- 下载并安装（默认安装到 `C:\Program Files (x86)\cloudflared\cloudflared.exe`）。
    
- 首次登录并创建隧道（按提示完成授权）：
    
    ```powershell
    cloudflared tunnel login
    cloudflared tunnel create localhost-yayue
    cloudflared tunnel list
    ```
    
    记下 `Tunnel UUID`，例如：
    
    ```
    f1c38ae0-dac0-4054-a6a6-740cd1fb3804
    ```
    

### 2.2 准备配置目录（**系统帐户专用**）

> 建议把 cloudflared 的配置与证书放在 **systemprofile** 下，便于作为服务/计划任务以 SYSTEM 身份运行。

```powershell
$sys = "C:\Windows\System32\config\systemprofile\.cloudflared"
mkdir $sys -Force
# 把 credentials JSON 拷贝/移动到 $sys
# 示例：f1c38ae0-dac0-4054-a6a6-740cd1fb3804.json
```

### 2.3 `config.yml`（**最终可用版本**）

> 放到：`C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`

```yaml
tunnel: f1c38ae0-dac0-4054-a6a6-740cd1fb3804
credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\f1c38ae0-dac0-4054-a6a6-740cd1fb3804.json

# 日志与网络选项（Windows 上更稳）
logfile: C:\Windows\System32\config\systemprofile\.cloudflared\cloudflared.log
loglevel: info
edge-ip-version: "4"          # ★ 避免 IPv6 环境异常（字符串更兼容）
protocol: http2
metrics: 127.0.0.1:20241

ingress:
  - hostname: gitlab.kakitomeru.link
    service: http://localhost:8089
  - hostname: sonar.kakitomeru.link
    service: http://localhost:9000
  - hostname: chat.kakitomeru.link
    service: http://localhost:8065
  - service: http_status:404   # 兜底规则（必需）
```

> **注意**：曾遇到旧版本 cloudflared 对 `edge-ip-version` 类型较敏感，**建议加引号**。

### 2.4 绑定 DNS（路由域名到隧道）

```powershell
cloudflared tunnel route dns f1c38ae0-dac0-4054-a6a6-740cd1fb3804 gitlab.kakitomeru.link
cloudflared tunnel route dns f1c38ae0-dac0-4054-a6a6-740cd1fb3804 sonar.kakitomeru.link
cloudflared tunnel route dns f1c38ae0-dac0-4054-a6a6-740cd1fb3804 chat.kakitomeru.link
```

> 执行后，Cloudflare DNS 会创建 `CNAME -> _<tunnel>.cfargotunnel.com`（橙云代理）。  
> 本机 `nslookup <域名>` 能解析到 Cloudflare Anycast（如 `104.21.x.x` / `2606:4700::...`）即正确。

---

## 3. 仅对 cloudflared 进程设置代理（不影响全局）

### 3.1 启动脚本 `run-cloudflared.cmd`

> 放在：`C:\Windows\System32\config\systemprofile\.cloudflared\run-cloudflared.cmd`

```bat
@echo off
setlocal

REM 仅对 cloudflared 进程生效的代理（无账号密码）
set HTTP_PROXY=http://127.0.0.1:9910
set HTTPS_PROXY=http://127.0.0.1:9910

REM 不经代理的地址（本地环回/内域名）
set NO_PROXY=localhost,127.0.0.1,::1,.kakitomeru.link

set CFG=C:\Windows\System32\config\systemprofile\.cloudflared\config.yml
set TUNNEL_ID=f1c38ae0-dac0-4054-a6a6-740cd1fb3804

REM 启动 cloudflared（按需添加 --autoupdate-freq 等）
"C:\Program Files (x86)\cloudflared\cloudflared.exe" --config "%CFG%" ^
  tunnel run "%TUNNEL_ID%"

endlocal
```

> 这样代理**只**作用于 cloudflared，GitLab/Sonar/Mattermost 本身不受影响。

### 3.2 计划任务开机自启（SYSTEM 身份）

```powershell
schtasks /Delete /TN "CloudflaredRun" /F 2>$null
schtasks /Create /RU "SYSTEM" /SC ONSTART /RL HIGHEST /TN "CloudflaredRun" ^
  /TR "C:\Windows\System32\config\systemprofile\.cloudflared\run-cloudflared.cmd"
```

> 也可以用 **Windows 服务**方式，但在我的环境中计划任务 + 独立代理变量更直观、可控。

---

## 4. Zero Trust（Access）：按路径放行 OAuth / Webhook

> 目的：让 **OAuth 回调** 与 **Webhook** 不被 Access 拦截；其它路径仍可按需保护（或不启用 Access）。

需要放行（Bypass/Allow）的路径：

- **GitLab OAuth**：`https://gitlab.kakitomeru.link/oauth/*`  
    （`/oauth/authorize`、`/oauth/token` 等）
    
- **Mattermost 插件回调（GitLab 插件）**：  
    `https://chat.kakitomeru.link/plugins/com.github.manland.mattermost-plugin-gitlab/oauth/complete*`
    
- **Mattermost 插件回调（GitHub 插件 + Webhook）**：
    
    - `https://chat.kakitomeru.link/plugins/github/oauth/complete`
        
    - `https://chat.kakitomeru.link/plugins/github/webhook`
        

### 4.1 控制台点选（最直观）

Zero Trust → **Access → Applications → Add application → Self-hosted**

- **按路径**创建应用（非常关键）：
    
    - `gitlab.kakitomeru.link/oauth/*` → 策略设为 **Bypass**（Include: Everyone）
        
    - `chat.kakitomeru.link/plugins/com.github.manland.mattermost-plugin-gitlab/oauth/complete*` → **Bypass**
        
    - `chat.kakitomeru.link/plugins/github/oauth/complete` → **Bypass**
        
    - `chat.kakitomeru.link/plugins/github/webhook` → **Bypass**
        

> 若之前你有“整个域名”的 Access 应用，**按路径**的应用会**只接管对应路径**，其上的 **Bypass** 策略优先生效。

### 4.2 Terraform（**Cloudflare Provider v5** 正确写法，支持“可复用策略”）

`main.tf`（片段示例）

```hcl
terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.9"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
variable "account_id" {}
variable "cloudflare_api_token" {}

# 1) 可复用策略：Everyone Bypass
resource "cloudflare_zero_trust_access_policy" "bypass_everyone" {
  account_id = var.account_id
  name       = "bypass-everyone"
  decision   = "bypass"
  include    = [{ everyone = true }]   # v5: 参数而非嵌套块
}

# 2) 按路径应用：GitLab /oauth/*
resource "cloudflare_zero_trust_access_application" "gitlab_oauth_path" {
  account_id = var.account_id
  name       = "gitlab-oauth-path"
  type       = "self_hosted"
  domain     = "gitlab.kakitomeru.link/oauth/*"
  app_launcher_visible = false
  policies = [cloudflare_zero_trust_access_policy.bypass_everyone.id]
}

# 3) 按路径应用：MM GitLab 回调
resource "cloudflare_zero_trust_access_application" "mm_gitlab_callback" {
  account_id = var.account_id
  name       = "mm-gitlab-callback"
  type       = "self_hosted"
  domain     = "chat.kakitomeru.link/plugins/com.github.manland.mattermost-plugin-gitlab/oauth/complete*"
  app_launcher_visible = false
  policies = [cloudflare_zero_trust_access_policy.bypass_everyone.id]
}

# 4) 按路径应用：MM GitHub OAuth 回调 & Webhook
resource "cloudflare_zero_trust_access_application" "mm_github_oauth" {
  account_id = var.account_id
  name       = "mm-github-oauth"
  type       = "self_hosted"
  domain     = "chat.kakitomeru.link/plugins/github/oauth/complete"
  app_launcher_visible = false
  policies = [cloudflare_zero_trust_access_policy.bypass_everyone.id]
}

resource "cloudflare_zero_trust_access_application" "mm_github_webhook" {
  account_id = var.account_id
  name       = "mm-github-webhook"
  type       = "self_hosted"
  domain     = "chat.kakitomeru.link/plugins/github/webhook"
  app_launcher_visible = false
  policies = [cloudflare_zero_trust_access_policy.bypass_everyone.id]
}
```

> v5 与旧版最大差异：**策略不再写 `application_id`**，改为**可复用策略**，在 **应用的 `policies = []`** 中**引用策略 ID**；`include` 是**参数**，**不是 block**。

---

## 5. Mattermost 与 GitLab / GitHub 集成要点（与 Tunnel/Access 的关系）

### 5.1 GitLab ↔ Mattermost（插件）

- GitLab 的 OAuth 应用：
    
    - 回调：`https://chat.kakitomeru.link/plugins/com.github.manland.mattermost-plugin-gitlab/oauth/complete`
        
- Mattermost GitLab 插件：
    
    - 按插件文档配置 Client ID/Secret、GitLab Base URL 等。
        
- **Access 放行**：
    
    - `gitlab.kakitomeru.link/oauth/*`（令牌交换）
        
    - `chat.kakitomeru.link/plugins/.../oauth/complete*`（MM 插件回调）
        
- **常见错误**：授权页弹不出来或回不来 → 基本都是 **Access 没按路径放行** 或 **Site URL / Redirect URL 不一致**。
    

### 5.2 GitHub ↔ Mattermost（官方 GitHub 插件）

- 在 GitHub 创建 OAuth App：
    
    - 回调：`https://chat.kakitomeru.link/plugins/github/oauth/complete`
        
- 在 GitHub（组织/仓库）创建 Webhook：
    
    - Payload URL：`https://chat.kakitomeru.link/plugins/github/webhook`
        
    - Content-Type：`application/json`
        
    - Secret：与插件配置中的 Webhook Secret 一致
        
- 在频道添加订阅：
    
    ```text
    /github subscriptions add owner/repo --features issues,pulls,issue_comments,pull_reviews,pushes,releases,workflow_success,workflow_failure
    ```
    
- **Access 放行**：上面这两个路径必须 **Bypass**。
    

---

## 6. 常用操作

### 6.1 校验 / 启动 / 停止 cloudflared（计划任务方案）

**校验配置：**

```powershell
$sys = "C:\Windows\System32\config\systemprofile\.cloudflared"
cloudflared --config "$sys\config.yml" tunnel ingress validate
```

**一键重启（管理员 PowerShell）：**

```powershell
$TaskName = "CloudflaredRun"
$SysDir   = "C:\Windows\System32\config\systemprofile\.cloudflared"
$UUID     = "f1c38ae0-dac0-4054-a6a6-740cd1fb3804"

cloudflared --config "$SysDir\config.yml" tunnel ingress validate

schtasks /End /TN "$TaskName" 2>$null
Start-Sleep -s 1
taskkill /IM cloudflared.exe /F 2>$null
Start-Sleep -s 1

schtasks /Run /TN "$TaskName"

schtasks /Query /TN "$TaskName" /V /FO LIST
cloudflared tunnel info $UUID
Get-Content "$SysDir\cloudflared.log" -Tail 100
```

**查看运行状态：**

```powershell
cloudflared tunnel info f1c38ae0-dac0-4054-a6a6-740cd1fb3804
Get-Content "C:\Windows\System32\config\systemprofile\.cloudflared\cloudflared.log" -Tail 100
```

**绑定/更新某个域名的 DNS 路由：**

```powershell
cloudflared tunnel route dns f1c38ae0-dac0-4054-a6a6-740cd1fb3804 gitlab.kakitomeru.link
```

### 6.2 DNS / 网络连通性自检

```powershell
# 清 DNS 缓存
ipconfig /flushdns

# 解析测试
nslookup gitlab.kakitomeru.link
Resolve-DnsName cfd-features.argotunnel.com
Resolve-DnsName cloudflare.com

# TCP 连通性（Cloudflare 边缘 IP 示例）
Test-NetConnection -ComputerName 198.41.200.73 -Port 443
```

> 若 `Resolve-DnsName cfd-features.argotunnel.com` 总只返回 SOA/超时，说明上游 DNS 或网络对该域名做了干扰。  
> 解决：把**当前网卡的 DNS** 改为 `1.1.1.1`（+ `8.8.8.8` 备份），或直接在 cloudflared 所在进程里**用代理**（本文已采用）。

---

## 7. 常见问题与排错

### 7.1 cloudflared 前台能通，一 Ctrl+C 就断；后台/服务起不来

- **服务读的是 systemprofile 下的配置**：`C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`。  
    你改了用户目录的 `C:\Users\Administrator\.cloudflared\config.yml` 对**服务/计划任务**无效。
    
- 计划任务/服务**没有设置代理变量** → cloudflared 无法出网，立刻重连/失败。  
    **用本文的 `run-cloudflared.cmd`** 在启动前设置 `HTTP[S]_PROXY`。
    
- 日志有 `Failed to fetch features ... dnsquery timeout` → DNS/网络到 Cloudflare 不通；  
    用 **1.1.1.1** 作 DNS，或依赖 **代理**。
    

### 7.2 `edge-ip-version` 报 “expected string found int”

- 把 `edge-ip-version: 4` 改成 `edge-ip-version: "4"`；旧版本对类型严格。
    

### 7.3 访问提示「host is configured as a Cloudflare Tunnel, but currently unable to resolve it」

- DNS 路由未创建或未生效：重新执行 `cloudflared tunnel route dns <UUID> <hostname>`。
    
- 隧道没有激活连接：`cloudflared tunnel info <UUID>` 若无连接，检查 cloudflared 是否在跑、代理是否生效。
    

### 7.4 Mattermost 中 GitLab 授权页不弹 / 回调 403

- **Access 未对路径放行**：
    
    - `gitlab.kakitomeru.link/oauth/*`
        
    - `chat.kakitomeru.link/plugins/com.github.manland.mattermost-plugin-gitlab/oauth/complete*`
        
- **Site URL / Redirect URL 不一致**：Mattermost **Environment → Site URL** 必须与实际域名一致。
    

### 7.5 GitHub 插件无消息

- GitHub Webhook 的 **Payload URL**、**Secret** 与插件配置对应；
    
- Zero Trust 对以下路径 **Bypass**：
    
    - `/plugins/github/oauth/complete`
        
    - `/plugins/github/webhook`
        
- 频道里执行 `/github subscriptions add ...`；在 GitHub 的 **Recent Deliveries** 查看是否 2xx。
    

---

## 8. 最终架构小图

```
[Windows 主机]
  ├─ GitLab     : http://localhost:8089
  ├─ SonarQube  : http://localhost:9000
  ├─ Mattermost : http://localhost:8065
  └─ cloudflared (通过代理 127.0.0.1:9910 出网)
        │ 出站
        ▼
   Cloudflare 边缘（Anycast）
        │
        ├─ gitlab.kakitomeru.link  ──> ingress → localhost:8089
        ├─ sonar.kakitomeru.link   ──> ingress → localhost:9000
        └─ chat.kakitomeru.link    ──> ingress → localhost:8065
             ▲
             └─ Zero Trust（Access）仅对以下路径 Bypass：
                  /oauth/*（GitLab）
                  /plugins/.../oauth/complete*（MM GitLab）
                  /plugins/github/oauth/complete（MM GitHub）
                  /plugins/github/webhook（MM GitHub）
```

---

## 9. 清单：我最终使用的关键文件与命令（可直接抄）

**`C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`**

```yaml
tunnel: f1c38ae0-dac0-4054-a6a6-740cd1fb3804
credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\f1c38ae0-dac0-4054-a6a6-740cd1fb3804.json
logfile: C:\Windows\System32\config\systemprofile\.cloudflared\cloudflared.log
loglevel: info
edge-ip-version: "4"
protocol: http2
metrics: 127.0.0.1:20241
ingress:
  - hostname: gitlab.kakitomeru.link
    service: http://localhost:8089
  - hostname: sonar.kakitomeru.link
    service: http://localhost:9000
  - hostname: chat.kakitomeru.link
    service: http://localhost:8065
  - service: http_status:404
```

**`C:\Windows\System32\config\systemprofile\.cloudflared\run-cloudflared.cmd`**

```bat
@echo off
setlocal
set HTTP_PROXY=http://127.0.0.1:9910
set HTTPS_PROXY=http://127.0.0.1:9910
set NO_PROXY=localhost,127.0.0.1,::1,.kakitomeru.link
set CFG=C:\Windows\System32\config\systemprofile\.cloudflared\config.yml
set TUNNEL_ID=f1c38ae0-dac0-4054-a6a6-740cd1fb3804
"C:\Program Files (x86)\cloudflared\cloudflared.exe" --config "%CFG%" tunnel run "%TUNNEL_ID%"
endlocal
```

**计划任务：**

```powershell
schtasks /Create /RU "SYSTEM" /SC ONSTART /RL HIGHEST /TN "CloudflaredRun" ^
  /TR "C:\Windows\System32\config\systemprofile\.cloudflared\run-cloudflared.cmd"
```

**DNS 路由：**

```powershell
cloudflared tunnel route dns f1c38ae0-dac0-4054-a6a6-740cd1fb3804 gitlab.kakitomeru.link
cloudflared tunnel route dns f1c38ae0-dac0-4054-a6a6-740cd1fb3804 sonar.kakitomeru.link
cloudflared tunnel route dns f1c38ae0-dac0-4054-a6a6-740cd1fb3804 chat.kakitomeru.link
```

**一键重启（管理员 PowerShell）：**

```powershell
$TaskName = "CloudflaredRun"
$SysDir   = "C:\Windows\System32\config\systemprofile\.cloudflared"
$UUID     = "f1c38ae0-dac0-4054-a6a6-740cd1fb3804"

cloudflared --config "$SysDir\config.yml" tunnel ingress validate
schtasks /End /TN "$TaskName" 2>$null
taskkill /IM cloudflared.exe /F 2>$null
schtasks /Run /TN "$TaskName"
cloudflared tunnel info $UUID
Get-Content "$SysDir\cloudflared.log" -Tail 100
```

**Zero Trust（Access）要放行的路径（Bypass/Allow）：**

```
gitlab.kakitomeru.link/oauth/*
chat.kakitomeru.link/plugins/com.github.manland.mattermost-plugin-gitlab/oauth/complete*
chat.kakitomeru.link/plugins/github/oauth/complete
chat.kakitomeru.link/plugins/github/webhook
```

---

## 10. 收尾建议

- **先在隐身窗口验证**：OAuth 授权能跳转完成、Webhook 投递 2xx。
    
- **日志是第一手线索**：
    
    - cloudflared：`C:\Windows\System32\config\systemprofile\.cloudflared\cloudflared.log`
        
    - Zero Trust：Access → Logs/Audit（看是否命中 Bypass）
        
    - GitHub Webhook：仓库/组织 → Settings → Webhooks → Recent Deliveries
        
- **最小放行面**：只对必要路径做 Bypass；其它路径按需保护或不启用。
    
- **备份 Tunnel 证书 JSON** 与 `config.yml`，防止迁移时遗失。
    

---

> 以上就是“无公网 IP、Windows、带网络限制”的完整实战记录。照本文配置，你可以**稳定地让三大自托管服务进入公网**，同时**不牺牲 OAuth/Webhook 的可用性**，并保持**代理只影响 cloudflared**、系统其余服务干净独立。祝顺利！