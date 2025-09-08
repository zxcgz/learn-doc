# 在 Java 服务里“不停机增改接口”的工程实践：多脚本引擎 + 前言规范 + CA 签名验真（含 SM2/ECDSA）

> 目标：让你的 Java（Spring Boot/WebFlux 亦可）后端在**不重启**的情况下，**新增或修改接口的行为与返回值**；接口的**路径/方法/必填参数与类型**都由**脚本自身**定义；上线前对脚本做**CA 级数字签名完整性校验**（支持 SM2/SM3 与 ECDSA/RSA）。

---

## 1. 方案概览

**核心思路（四件事）：**

1. **动态总线（/dyn/**）**  
    在服务里挂一个“动态路由入口”（如 `/dyn/**`）。所有“在线新增/修改”的接口都在这条总线上注册与调度（对外可用网关做透明重写）。
    
2. **多脚本引擎**  
    同一套调用约定，底层可切换 **JSR-223 引擎**（Kotlin Script、Rhino-JS 等，不依赖特定 JDK）或 **GraalVM Polyglot**（JS、Python、Ruby…）。
    

> 先用 JSR-223 起步，未来需要 Python 3/多语言时切换到 GraalVM。

3. **脚本前言（Front-Matter）+ 统一导出函数**  
    脚本开头用 **YAML 前言**声明：`method/path`、参数来源与类型、是否必填/默认值；脚本体里**必须导出** `handle(ctx)`。  
    服务端**先解析前言**得到清单（manifest）→ 注册路由；收到请求后做**参数抽取与类型校验** → 调用 `handle(ctx)` → 返回 JSON。
    
4. **CA 签名验真**  
    脚本发布方用**签名证书**对**脚本原始字节**签名；服务端在注册或热更新前**先验签**（+ 验链到受信根 CA、吊销检查、EKU 检查），通过后才加载执行。
    

---

## 2. 目录与依赖

**Maven 关键依赖（按需裁剪）：**

```xml
<dependencies>
  <!-- Web & JSON -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
  <dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
  </dependency>

  <!-- YAML 前言解析 -->
  <dependency>
    <groupId>org.yaml</groupId>
    <artifactId>snakeyaml</artifactId>
    <version>2.2</version>
  </dependency>

  <!-- 多脚本（JSR-223 路线） -->
  <dependency>
    <groupId>org.jetbrains.kotlin</groupId>
    <artifactId>kotlin-scripting-jsr223</artifactId>
    <version>1.9.24</version>
  </dependency>
  <dependency>
    <groupId>org.mozilla</groupId>
    <artifactId>rhino-engine</artifactId>
    <version>1.7.14</version>
  </dependency>

  <!-- （可选）GraalVM Polyglot 路线：JS / Python3 等 -->
  <!--
  <dependency>
    <groupId>org.graalvm.polyglot</groupId>
    <artifactId>polyglot</artifactId>
    <version>24.0.1</version>
  </dependency>
  <dependency>
    <groupId>org.graalvm.js</groupId>
    <artifactId>js</artifactId>
    <version>24.0.1</version>
  </dependency>
  <dependency>
    <groupId>org.graalvm.python</groupId>
    <artifactId>python</artifactId>
    <version>24.0.1</version>
  </dependency>
  -->

  <!-- CA 验签（含 SM2/SM3、CMS、OCSP/CRL 支持） -->
  <dependency>
    <groupId>org.bouncycastle</groupId>
    <artifactId>bcprov-jdk18on</artifactId>
    <version>1.78.1</version>
  </dependency>
  <dependency>
    <groupId>org.bouncycastle</groupId>
    <artifactId>bcpkix-jdk18on</artifactId>
    <version>1.78.1</version>
  </dependency>
</dependencies>
```

**建议目录：**

```
src/
  main/java/...
scripts/
  js/hello.js
  kts/echo.kts
  py/hello.py        # (可选，GraalPython)
sign/
  root-ca.pem        # 你的受信根
  hello.js.sig       # 分离签名
  hello.js.cert.pem  # 签名者证书链（leaf + intermediates）
```

---

## 3. 前言规范（语言无关）与上下文

**YAML 前言（脚本文件开头，三横线或注释块包裹均可）：**

```yaml
---
route:
  method: GET                # GET | POST | PUT | DELETE | PATCH
  path: /dyn/hello/{name}   # 支持模板变量
params:
  - name: name              # 参数名
    in: path                # query | path | header | body
    type: string            # string | int | number | bool
    required: true
  - name: age
    in: query
    type: int
    required: false
    default: 18
---
```

**统一导出函数：**

- 脚本必须导出 `handle(ctx)`（JS/Kotlin/ Python 写法不同，但名称一致）。
    
- `ctx`（只读白名单）包含：
    
    - `method`、`path`、`pathVars`、`query`、`headers`
        
    - `bodyObj`（若是 JSON 将解析为 Map）
        
    - `params`（按前言声明**已做校验与类型转换**的参数聚合）
        
    - `now`（毫秒时间戳）
        

**示例：JavaScript（JSR-223 Rhino 或 GraalJS）**

```javascript
/*
---
route:
  method: GET
  path: /dyn/hello/{name}
params:
  - { name: name, in: path,  type: string, required: true }
  - { name: age,  in: query, type: int,    required: false, default: 18 }
---
*/
function handle(ctx) {
  return { code: 0, msg: `hello ${ctx.params.name}, age=${ctx.params.age}`, at: ctx.now };
}
```

**示例：Kotlin Script（JSR-223）**

```kotlin
/*---
route:
  method: POST
  path: /dyn/echo
params:
  - { name: x, in: body, type: number, required: true }
---*/
fun handle(ctx: Map<String, Any?>): Any? {
  val p = ctx["params"] as Map<String, Any?>
  return mapOf("code" to 0, "echo" to p["x"])
}
```

**（可选）GraalPython**

```python
# ---
# route: { method: GET, path: /dyn/py/hello }
# params: [ { name: who, in: query, type: string, required: true } ]
# ---
def handle(ctx):
    return { "code": 0, "hello": ctx["params"]["who"] }
```

---

## 4. 服务端流程（注册与执行）

### 4.1 注册流程（在线新增/更新接口）

1. **接收上传**（推荐 multipart）：`script`、`sig`（或 `p7s`）、`certChain`。
    
2. **CA 验签**
    
    - 对 `script` **原始字节**验签（见第 6 节），并验证证书链 → 受信根；
        
    - 强制 EKU = CodeSigning；可做 OCSP/CRL；可设签发者/OU 白名单。
        
3. **解析前言**
    
    - 提取 YAML → 生成 manifest；校验 `method/path` 必填。
        
4. **注册路由**
    
    - 构建 `PathTemplate`（支持 `{var}`）；
        
    - 将 `manifest`、脚本代码、执行引擎（JSR-223/Graal）绑定到路由表中；
        
    - 记录审计：`digest、签名者、证书序列号、算法、签名时间` 等。
        
5. **热更新**
    
    - 监听文件 mtime 或版本号；变化时重复 2–4 步，替换路由实现。
        

### 4.2 执行流程（请求进来）

1. 动态总线根据 `method + path` **匹配路由模板** → `pathVars`。
    
2. 按 manifest 从 `query/path/header/body` 抽取参数并做**类型校验/默认值填充**（失败返回 400）。
    
3. 构造 `ctx`，将 `params`、`pathVars`、`bodyObj` 等注入脚本引擎，调用 `handle(ctx)`（**独立线程池 + 超时**）。
    
4. 将脚本返回对象统一序列化为 JSON 输出。
    

> **安全默认值**：
> 
> - 执行池独立、每次调用设置**超时**（如 3s）；
>     
> - GraalVM 路线默认**禁止 HostAccess/IO/线程创建**；
>     
> - 只暴露 `ctx` 指定字段，禁止反射任意访问。
>     

---

## 5. 多脚本执行引擎的实现要点

- **JSR-223**：Kotlin Script、Rhino-JS；通过 `ScriptEngineManager` 获取引擎；先 `eval(code)`，再用 `Invocable.invokeFunction("handle", ctx)` 调用。
    
- **GraalVM**：通过 `Context.newBuilder(lang)` 构建上下文，收紧权限；`eval(code)` 后从 `bindings` 里拿到 `handle` 执行。
    

> 选择策略：
> 
> - **起步**：只需 JS/Kotlin → 用 JSR-223（JDK 8/11 也能跑）。
>     
> - **多语言/高性能 JS**：跑在 **GraalVM JDK**（或引入语言组件）。
>     

---

## 6. 用 CA 对脚本做完整性校验

### 6.1 推荐交付方式：**分离签名（Detached Signature）**

**交付物：**

- `script`：原始脚本（含前言 + 逻辑）
    
- `script.sig`：对 **script 原始字节**的签名（SM2/SM3 或 SHA256withECDSA/RSA）
    
- `script.cert.pem`：**证书链**（leaf + intermediates；根可不带）
    
- （可选）`script.tsr`：RFC 3161 时间戳（证明签名时间）
    

**服务端校验清单：**

1. **读取脚本原始字节**（不要做任何换行/编码替换）。
    
2. **加载证书链** → **验证签名**（用叶子证书公钥），算法白名单：`SM3withSM2` / `SHA256withECDSA` / `SHA256withRSA` 等。
    
3. **PKIX 验链**到你的**受信根 CA**；
    
4. **EKU 检查**：必须包含 `CodeSigning (1.3.6.1.5.5.7.3.3)`；
    
5. （可选）**吊销检查**：OCSP/CRL；
    
6. （可选）**TSA 签时**策略：签名时刻早于吊销/过期允许历史有效；
    
7. 通过后再进入“解析前言/注册路由”。
    

> **CMS/PKCS#7**（`*.p7s`）也是成熟选项：将证书链/时间戳一并放进签名容器里，服务端用 BC CMS 统一校验，工程体验更好。

### 6.2 备选交付方式：**内联签名块（Inline）**

把签名块放在脚本**末尾**固定分隔符中（包含算法、证书链、签名值等）。注册时用正则**剥离签名块**，对**剩余字节**验签。  
优点单文件；缺点需严格定义“可签范围”，避免空白/换行差异导致验签失败。**推荐优先使用分离签名**。

### 6.3 关键实现要点（摘要）

- **摘要算法**：SM 系列用 **SM3**，国际通用用 **SHA-256**。
    
- **算法白名单**：拒绝 MD5/SHA-1。
    
- **证书用途**：签名证书与 TLS/个人证分离；强制 `KeyUsage: digitalSignature`。
    
- **策略 OID**：可要求证书包含自定义 Policy OID（“企业脚本签名策略”）。
    
- **信任锚固定（pin）**：仅信任内置根/中间 CA。
    
- **审计**：记录 `digestHex、signerSubject、serial、issuer、alg、tsaTime`，并存证签名与脚本摘要。
    
- **失败策略**：吊销网络异常时，按你的业务选择“软失败/硬失败”。
    

**命令行签名示例：**

- **SM2（GmSSL 生态，示意）**
    
    ```bash
    # 对 script 做 SM2/SM3 签名（输出 script.sig）
    gmssl sm2utl -sign -key signer.key.pem -in script -out script.sig
    cat signer.crt.pem ca-chain.pem > script.cert.pem
    ```
    
- **CMS（OpenSSL，RSA/ECDSA）**  
    _Detached_（分离签名）：
    
    ```bash
    openssl cms -sign -binary -in script \
      -signer signer.crt.pem -inkey signer.key.pem \
      -certfile intermediates.pem \
      -outform DER -out script.p7s -nosmimecap -nodetach
    ```
    

---

## 7. 管理与调用示例

**注册（脚本自己声明 method/path/params，服务端先验签再注册）**

```bash
curl -X POST http://localhost:8080/admin/dyn/register \
  -H 'Content-Type: multipart/form-data' \
  -F 'engine=JSR223' \
  -F 'language=js' \
  -F 'script=@scripts/js/hello.js' \
  -F 'sig=@sign/hello.js.sig' \
  -F 'certChain=@sign/hello.js.cert.pem'
```

**调用：**

```bash
curl "http://localhost:8080/dyn/hello/Alice?age=20"
# => {"code":0,"msg":"hello Alice, age=20","at":...}
```

**切换引擎（Kotlin Script / GraalPython）**：只需在注册时改 `engine/language` 与 `script` 文件即可。

---

## 8. 安全与治理清单（上线必做）

- **鉴权与审批**：`/admin/dyn/register` 必须强鉴权；脚本入库前执行审批/扫描。
    
- **签名强制**：未签名/验签失败/证书不受信 → 一律拒绝。
    
- **沙箱与限时**：独立线程池 + 执行超时（如 3s）；Graal 默认禁用 `HostAccess/IO/线程`。
    
- **资源配额**：限制返回体大小、执行内存、并发数。
    
- **网关策略**：对 `/dyn/**` 单独限流、熔断、WAF、审计。
    
- **版本化与回滚**：脚本 `id/version/sha256`；支持 `dryRun` 自测模式与一键回退上一版。
    
- **可观测性**：日志包含 `routeId/version/execTime/timeout/error`，导入指标系统（Prometheus 等）。
    
- **最小上下文**：`ctx` 严格白名单；避免暴露服务端私密对象。
    
- **依赖治理**：对脚本引擎与加密库（BC/Graal）定期升级，关闭不必要算法。
    

---

## 9. 常见问题（FAQ）

**Q1：脚本改了为什么没生效？**  
A：确认是否通过“注册接口”完成更新（或启用文件监控）；注册时若验签失败/manifest 无效会被拒绝。

**Q2：如何新增一个新路径的接口？**  
A：直接在脚本前言里改 `route.method/path`，重新注册即可（不需要改 Java 代码）。

**Q3：能否不暴露 `/dyn/**` 给公网？**  
A：可以。建议只在内网开放 `/admin/**`；公网通过 API 网关把正式路径重写到 `/dyn/**`，并对调用方透明。

**Q4：能否只允许某些团队/证书发布脚本？**  
A：可以。对证书做 **Issuer/Subject/OU 白名单** 或 **指纹白名单** 校验。

**Q5：多引擎带来的兼容性？**  
A：统一 `handle(ctx)` 协议与 `ctx` 字段即可；返回值统一 JSON 序列化。需要跨语言共享库时优先放在 Java 侧做服务/适配。

---

## 10. 性能与稳定性建议

- **脚本编译/解析缓存**：按 `(engine, lang, scriptDigest)` 缓存已编译句柄，减少每次 eval 成本。
    
- **线程池隔离**：动态脚本执行池与业务线程池隔离，防止相互影响。
    
- **冷/热路径分离**：对热点动态接口考虑“预热执行”或“转固”（将稳定脚本固化为 Java 实现）。
    
- **回放自测**：注册时支持 `dryRun`，用历史请求样本回放并对比返回结构/耗时。
    

---

## 11. 最小落地步骤（Checklist）

1. 引入依赖（Web/JSON、SnakeYAML、JSR-223 或 Graal、BouncyCastle）。
    
2. 实现：`ScriptFrontMatter.parse()`、`PathTemplate`、`ParamValidator`、`MultiEngine`、`DynRegistry`、`DynController`。
    
3. 实现：**CA 验签**模块（分离签名优先；含验链、EKU、OCSP/CRL 可选）。
    
4. 打通注册接口：先验签 → 解析前言 → 注册路由。
    
5. 配置网关与鉴权；加执行超时、限流、审计与回滚。
    
6. 写两三个示例脚本（JS/KTS/Python），完成端到端自测。
    

---

## 12. 总结

这套方案把“动态接口”当作**受控的发布物**来治理：

- **脚本自描述**（前言声明接口契约）+ **统一入口**（handle(ctx)）= 低耦合、高灵活；
    
- **多引擎抽象**（JSR-223/Graal）= 语言可插拔；
    
- **CA 签名验真**（含 SM2/ECDSA、吊销检查、EKU）= 供应链安全；
    
- 配合**灰度/回滚/审计**，能在生产环境**安全地“不停机改/增接口”**。
    

> 如果你已经确定 JDK 版本、网关（Nginx/APISIX/Envoy）、以及要支持的脚本语言优先级，可以把这些信息列出来，接着把本文的骨架裁剪成一个“可直接拷贝进仓库”的 demo 项（含 Dockerfile、示例脚本与签名样例）。