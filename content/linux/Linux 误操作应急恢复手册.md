---
title: Linux 误把 /root 搬到 /usr/lib64 的应急恢复手册
date: 2025-10-21
tags: [linux, 运维, 故障恢复, rpm, deb, SELinux]
---

# 概要

一次误操作把 **`/root`** 下的文件/目录移动到了 **`/usr/lib64`**。不要重启，先保持当前 root 会话不断开，按照本文步骤把误放的东西**安全**搬回 `/root`，修好权限与 SELinux，上最后做一次自检。

> 关键点：同分区 `mv` 只改目录项，**`mtime` 不变，`ctime` 会更新**。因此，按时间窗口用 **ctime** 来筛。再配合包管理器（`rpm -qf` / `dpkg -S`）排除系统自带文件。

---

# 立即操作

```bash
# 确保 /root 存在且权限正确
mkdir -p /root
chown root:root /root
chmod 700 /root
```

---

# 快速修复：最近 N 分钟内迁回（一条命令）

你已确认在最近 25 分钟内发生：

**RPM 系（CentOS / RHEL / Alma / Rocky / Fedora）**
```bash
mkdir -p /root && chown root:root /root && chmod 700 /root && find /usr/lib64 -xdev -mindepth 1 -maxdepth 1 -cmin -25 -print0 | while IFS= read -r -d '' p; do rpm -qf --quiet "$p" || printf '%s\0' "$p"; done | xargs -0 -r -I{} mv -vn -- "{}" /root/ && [ -d /root/.ssh ] && chmod 700 /root/.ssh && chown -R root:root /root/.ssh && find /root/.ssh -type f -exec chmod 600 {} \; || true && command -v restorecon >/dev/null 2>&1 && restorecon -Rv /root /usr/lib64 || true && ldconfig
```

**DEB 系（Ubuntu / Debian）**
```bash
mkdir -p /root && chown root:root /root && chmod 700 /root && find /usr/lib64 -xdev -mindepth 1 -maxdepth 1 -cmin -25 -print0 | while IFS= read -r -d '' p; do dpkg -S "$p" >/dev/null 2>&1 || printf '%s\0' "$p"; done | xargs -0 -r -I{} mv -vn -- "{}" /root/ && [ -d /root/.ssh ] && chmod 700 /root/.ssh && chown -R root:root /root/.ssh && find /root/.ssh -type f -exec chmod 600 {} \; || true && command -v restorecon >/dev/null 2>&1 && restorecon -Rv /root /usr/lib64 || true && ldconfig
```

> `mv -vn`：不覆盖同名，输出操作详情。  
> 先干跑预览：把 `mv -vn` 改成 `echo mv -vn`。

---

# 更精确：按时间窗口（ctime）恢复

当你知道一个大致的时间区间（例如 09:10–09:20），用 **ctime 窗口 + 包管理器过滤**：

```bash
T1='2025-10-21 09:10'  # 误操作开始前一点
T2='2025-10-21 09:20'  # 误操作结束后一点

# RPM 系
touch -d "$T1" /tmp/t1 && touch -d "$T2" /tmp/t2
find /usr/lib64 -xdev -mindepth 1 -maxdepth 1 -cnewer /tmp/t1 ! -cnewer /tmp/t2 -print0 | while IFS= read -r -d '' p; do rpm -qf --quiet "$p" || printf '%s\0' "$p"; done | xargs -0 -r -I{} mv -vn -- "{}" /root/
[ -d /root/.ssh ] && chmod 700 /root/.ssh && chown -R root:root /root/.ssh && find /root/.ssh -type f -exec chmod 600 {} \;
command -v restorecon >/dev/null 2>&1 && restorecon -Rv /root /usr/lib64 || true
ldconfig

# DEB 系
touch -d "$T1" /tmp/t1 && touch -d "$T2" /tmp/t2
find /usr/lib64 -xdev -mindepth 1 -maxdepth 1 -cnewer /tmp/t1 ! -cnewer /tmp/t2 -print0 | while IFS= read -r -d '' p; do dpkg -S "$p" >/dev/null 2>&1 || printf '%s\0' "$p"; done | xargs -0 -r -I{} mv -vn -- "{}" /root/
[ -d /root/.ssh ] && chmod 700 /root/.ssh && chown -R root:root /root/.ssh && find /root/.ssh -type f -exec chmod 600 {} \;
command -v restorecon >/dev/null 2>&1 && restorecon -Rv /root /usr/lib64 || true
ldconfig
```

> `find` 若支持 GNU 扩展，也可写成：`-newerct "$T1" ! -newerct "$T2"`。

---

# 为什么不用 mtime？

- **同分区 `mv`**：只改变目录项，不改文件内容，`mtime` 不变，**`ctime` 更新**。
- **跨分区 `mv`**：底层是复制+删除，目标文件一定有新 `ctime`，`mtime` 可能保持原值或变新值，整体仍以 **`ctime`** 更可靠。

---

# 善后与自检

```bash
# 修权限（尤其是 /root/.ssh）
[ -d /root/.ssh ] && chmod 700 /root/.ssh && chown -R root:root /root/.ssh && find /root/.ssh -type f -exec chmod 600 {} \;

# SELinux（如启用）
command -v restorecon >/dev/null 2>&1 && restorecon -Rv /root /usr/lib64

# 刷新动态链接缓存
ldconfig

# 再次审计：/usr/lib64 顶层是否还剩“非包管理”的陌生条目
# RPM
find /usr/lib64 -xdev -mindepth 1 -maxdepth 1 -printf '%p\0' | while IFS= read -r -d '' p; do rpm -qf --quiet "$p" || echo "Unowned: $p"; done

# DEB
find /usr/lib64 -xdev -mindepth 1 -maxdepth 1 -printf '%p\0' | while IFS= read -r -d '' p; do dpkg -S "$p" >/dev/null 2>&1 || echo "Unowned: $p"; done
```

---

# 常见场景与提示

- **你当时执行的是 `mv /root/* /usr/lib64`**  
  星号不会匹配隐藏文件，`.ssh/、.bashrc` 等还在 `/root`。但也可能把 `Downloads/、Documents/` 等搬走了。按上面方法筛回来即可。

- **顶层还是有残留**  
  先 `ls -ld` 看清楚。出现系统库（`libxxx.so`）或包管理器拥有的路径，别动。必要时：  
  - RPM：`dnf/yum reinstall glibc\*`  
  - DEB：`apt --reinstall install libc6`

- **空间告急**  
  优先把体积大的压缩包、日志、镜像等搬回 `/root` 或临时放 `/var/tmp`。`df -h` 观察空间。

- **无法使用密钥登录**  
  别断开当前 root 会话。若已断：用另一个 sudo 账号、控制台、或救援模式挂载根分区，按文中步骤把 `/root/.ssh` 搬回并修权限。

---

# 脚本版（含干跑）

已附一组脚本（RPM/DEB 各一套），支持：
- **最近 N 分钟恢复**：`./rpm_restore_recent.sh 25`
- **按时间窗口恢复**：`./rpm_restore_time_window.sh "2025-10-21 09:10" "2025-10-21 09:20"`
- **审计未被包管理器接管的顶层条目**：`./audit_unowned_rpm.sh`
- 通过 `DRY_RUN=1` 环境变量开启干跑（仅打印要执行的 mv，不真正移动）。

详见 `scripts/README.md`。

---

# 附：更严格的筛选（可选）

如果担心顶层不足以覆盖（极少见），可以在顶层筛出**疑似目录**（例如 `Documents/、Downloads/` 等）后再对这些目录**定点递归**检查其子项是否也在时间窗口内，再搬回。建议只在确认这些目录确实来自 `/root` 时使用，避免误动系统目录。

---

# Checklist

- [ ] 不重启，保持 root 会话。
- [ ] 先建好 `/root` 并修权限。
- [ ] 用 `ctime` + 包管理器过滤在 `/usr/lib64` 顶层筛条目。
- [ ] 迁回 `/root`，干跑预览后再执行。
- [ ] 修 `.ssh` 权限、`restorecon`（如启用）、`ldconfig`。
- [ ] `Unowned` 审计收尾。
