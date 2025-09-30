
date: 2025-09-30 11:00 +09:00  
tags: [git, remote, how-to, devops]  
aliases: [修改 Git 远程地址, git remote set-url, 改origin地址]

> [!summary] 这篇文章做什么  
> 一页讲清：如何在本地仓库中**修改远程仓库地址**（例如从 HTTPS 换到 SSH、从旧仓库迁到新仓库），并给出常见场景速查表与故障排查清单。

---

## 快速开始：把 `origin` 的 URL 改成新地址

```bash
# 查看当前远程列表
git remote -v

# 同时修改 fetch 和 push 的地址
git remote set-url origin <新地址>

# 再次确认
git remote -v
```

示例：

```bash
# 切换到 SSH
git remote set-url origin git@github.com:user/repo.git
# 或切回 HTTPS
git remote set-url origin https://github.com/user/repo.git
```

> [!tip] 小贴士  
> 仅改变远程地址**不会**影响本地分支与历史，只是把“去哪里 fetch/push”指向了新位置。

---

## 只改 push、或配置**多个** push 地址（选用）

```bash
# 仅修改 push 地址（fetch 不变）
git remote set-url --push origin <新push地址>

# 为同一个远程添加第二个 push 地址（推送时会同步到多个仓库）
git remote set-url --add --push origin <另一个push地址>

# 删除某个 push 地址
git remote set-url --delete --push origin <要删的push地址>
```

> [!example] 典型用法  
> 代码托管在 GitHub，同时镜像推送到自建 GitLab：  
> 先把 fetch 指向 GitHub，然后把两个 push 地址都挂到 `origin` 上。

---

## 远程名需要重命名？（如 `origin` → `upstream`）

```bash
git remote rename origin upstream
```

常见于：你的仓库 fork 自上游项目，上游设为 `upstream`，你自己的仓库设为 `origin`。

---

## 新地址首次推送（换库后第一次）

```bash
# main 或 master 视你的分支而定
git push -u origin <你的分支名>
```

`-u` 会把本地分支与远程分支建立跟踪关系，后续可直接 `git push`/`git pull`。

---

## 子模块也迁了？别忘了 `.gitmodules`

1. 编辑项目根目录的 `.gitmodules`，把 URL 换成新地址。
    
2. 同步配置并更新子模块：
    

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

---

## 直接改配置文件（另一条路）

打开项目根目录下 `.git/config`，找到类似段落：

```ini
[remote "origin"]
    url = <新地址>
    # 可选：仅用于 push 的地址
    # pushurl = <仅push地址>
```

保存即可（等效于命令行）。

---

## 常见场景速查表

|场景|命令|
|---|---|
|改 `origin` 的 fetch+push 地址|`git remote set-url origin <新地址>`|
|只改 push 地址|`git remote set-url --push origin <新push地址>`|
|添加第二个 push 目标|`git remote set-url --add --push origin <另一个push地址>`|
|删除某个 push 目标|`git remote set-url --delete --push origin <要删的push地址>`|
|远程重命名|`git remote rename origin upstream`|
|新远程首次推送并建立跟踪|`git push -u origin <分支>`|
|验证远程可达性|`git ls-remote --heads origin`|

---

## 常见错误与快速排查

> [!warning] 推送失败但能拉取：多半是**凭据**或**权限**问题
> 
> - HTTPS：本机可能缓存了旧的用户名/Token。更新或清理本机凭据管理器后重试。
>     
> - SSH：`Permission denied (publickey)` → 检查是否把**正确的公钥**添加到新平台，并确认私钥正被 ssh-agent 使用。
>     

> [!bug] `fatal: No such remote 'origin'`  
> 说明还没添加这个远程。
> 
> ```bash
> git remote add origin <地址>
> # 若此前误添加过别名，先看现有远程：
> git remote -v
> ```

> [!bug] `fatal: remote origin already exists`  
> 你在 `remote add` 时远程已存在。要么 `set-url`，要么移除后重加：
> 
> ```bash
> git remote set-url origin <新地址>
> # 或
> git remote remove origin && git remote add origin <新地址>
> ```

> [!bug] `remote: Repository not found.`
> 
> - 远程地址拼错（组织名/仓库名大小写）。
>     
> - 你对目标仓库没有权限（尤其是私有仓库）。
>     
> - 目标仓库已被删除或迁移，找管理员确认。
>     

> [!tip] 快速自检连通性
> 
> ```bash
> git ls-remote --heads origin
> ```
> 
> 能列出分支说明鉴权与网络通常正常。

---

## FAQ

**Q: 我只是把 GitHub 的 HTTPS 改成 SSH，要不要重新 clone？**  
A: 不用。`git remote set-url origin git@github.com:user/repo.git` 即可无缝切换。

**Q: 我想一份代码同时推到两个远程？**  
A: 用“多个 push 地址”或直接新增第二个远程：

```bash
git remote set-url --add --push origin git@github.com:user/repo.git
git remote set-url --add --push origin git@gitlab.example.com:group/repo.git
# 或者
git remote add mirror git@gitlab.example.com:group/repo.git
git push mirror <分支>
```

**Q: 子模块地址改了但还是拉不下来？**  
A: 改 `.gitmodules` 后一定要 `git submodule sync --recursive` 再 `update --init --recursive`。

---

## 参考命令清单（可直接拷贝）

```bash
# 0) 查看远程
git remote -v

# 1) 改 origin 地址
git remote set-url origin <新地址>

# 2) 只改 push 地址 / 多 push 地址
git remote set-url --push origin <新push地址>
git remote set-url --add --push origin <另一个push地址>
git remote set-url --delete --push origin <要删的push地址>

# 3) 远程重命名
git remote rename origin upstream

# 4) 首次推送并建立跟踪
git push -u origin <分支>

# 5) 子模块
git submodule sync --recursive
git submodule update --init --recursive

# 6) 连通性自检
git ls-remote --heads origin
```

---

> [!note] 版本与环境  
> 本文适用于常见 Git 版本（2.x+）与 macOS / Linux / Windows 命令行环境。不同 GUI 客户端位置不同，但原理一致：**修改远程 URL** 即可。