

> 目标：在**不改动现有后端与网络架构**（不新增主域名、HAProxy、GSLB 等）的前提下，仅通过**客户端**实现「多域/多 IP 线路择优、故障自动切换、弱网稳定性提升」。

---

## 1. 背景与结论

- 业务需要在多运营商/跨地域环境下保持**连续性和稳定性**。
    
- 由于**不允许改动现网**（不添加主域名、LB、反向代理等），可行路径是：  
    **在客户端维护多条可用线路（多个域名或同一域名的多 IP），通过择优与自动切换保障可用性**。
    

### 结论（可落地）

- **Web（JS）**：仅能在**多个域名**之间切换；**无法**对同一域名强制指定某个 IP（浏览器 DNS/TLS 接管）。
    
- **Android / iOS 原生**：可在**多个域名**间择优，也可通过**自定义 DNS/解析顺序**影响**同一域名**的多 IP 选择。
    
- **读操作**采用**对冲请求（Hedged Requests）**，**写操作**采用**幂等键 + 有限重试**。
    
- 通过**端内打分模型**（基于 RTT/成功率的指数平滑）实现**动态排序与持久化**，持续自优化。
    

---

## 2. 约束与边界（纯客户端方案的“物理极限”）

- **浏览器限制**
    
    - 不能选择同域名的具体 IP 进行 HTTPS 连接；
        
    - 跨域访问需满足 **CORS**；
        
    - 证书校验由浏览器完成，**不允许用 IP 直连**（会与证书主机名不匹配）。
        
- **原生端**
    
    - 可实现**自定义 DNS**、连接回调、握手信息采集并打分；
        
    - 可做对冲、顺序重试、连接级超时。
        
- **幂等性**
    
    - 写操作的自动重试**必须**配合 **Idempotency-Key**；服务端需要有 5–10 分钟的去重窗口（不改架构，仅加代码即可）。
        

---

## 3. 总体思路（通用到三端）

1. **线路池**：预置多条可用线路（多个域名；原生端亦可针对同域多 IP）。
    
2. **健康检查与测速**：
    
    - 建议保留轻量 `GET/HEAD /healthz` 接口或静态资源用于端侧测速（返回 200 即可）；
        
    - Web 可用 `mode: "no-cors"` 的 `HEAD` 做“无侵入”测速。
        
3. **读操作（GET/HEAD）**：
    
    - **对冲**：对排名前 2 的线路并发请求，**延迟少量毫秒**触发第二条，取先返回的结果；失败则回退其他线路。
        
4. **写操作（POST/PUT/PATCH/DELETE）**：
    
    - **顺序尝试** + **Idempotency-Key**，失败后**换线路**再试 1 次（谨慎重试）。
        
5. **打分模型**：
    
    - 指标：RTT（指数平滑）、最近成功时间、失败惩罚；
        
    - 策略：RTT 采用 EMA（如 `rtt = rtt*0.7 + new*0.3`），成功 +5，失败 −8，定期衰减；
        
    - 持久化（Web：`localStorage`；Android：`SharedPreferences`；iOS：`UserDefaults`）。
        
6. **可观测性**（强烈建议）
    
    - 上报指标：选路、RTT、HTTP 码、失败类型、切换次数、对冲触发次数等；
        
    - 便于定位异常线路与动态调参。
        

---

## 4. 平台实现

### 4.1 Web（JS / TS）

**特点与限制**

- 只能在**多个域名**间切换；同一域的多 IP 不可控；
    
- 必须满足 **CORS**；Cookie 跨域共享受限，建议鉴权使用 **Bearer/JWT**；
    
- 可使用 `HEAD /healthz` + `mode: "no-cors"` 做轻量测速。
    

**最小可用示例：`smartFetch`**

```ts
type Endpoint = { base: string; rtt?: number; score?: number; lastOk?: number };
const KEY = "ep_metrics_v1";

function load(bases: string[]): Endpoint[] {
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  return bases.map(b => ({ base: b, ...(saved[b]||{}) }));
}
function save(eps: Endpoint[]) {
  const m: Record<string, any> = {};
  eps.forEach(e => m[e.base] = { rtt: e.rtt||0, score: e.score||0, lastOk: e.lastOk||0 });
  localStorage.setItem(KEY, JSON.stringify(m));
}
function rank(eps: Endpoint[]) {
  return [...eps].sort((a,b)=>{
    const S = (x: Endpoint) => (x.score||0)+(x.lastOk||0)/1e5-(x.rtt||1e5);
    return S(b) - S(a);
  });
}
async function ping(u: string) {
  const t0 = performance.now();
  try { await fetch(u, { method:"HEAD", mode:"no-cors", cache:"no-store" }); } catch {}
  return performance.now()-t0;
}

export async function smartFetch(
  path: string,
  opt: { endpoints: string[]; method?: string; init?: RequestInit; hedgeDelayMs?: number }
) {
  const method = (opt.method||"GET").toUpperCase();
  let eps = rank(load(opt.endpoints));

  // 冷启动快速测速（前 3 条）
  await Promise.all(eps.slice(0,3).map(async e=>{
    const t = await ping(e.base + "/healthz");
    e.rtt = e.rtt ? e.rtt*0.7 + t*0.3 : t;
    e.score = (e.score||0) + 1;
  }));
  save(eps); eps = rank(eps);

  const upd = (base: string, ok: boolean, rtt?: number) => {
    eps = eps.map(e => e.base===base ? {
      ...e,
      lastOk: ok ? Date.now() : e.lastOk||0,
      rtt: rtt ? (e.rtt ? e.rtt*0.7 + rtt*0.3 : rtt) : e.rtt,
      score: (e.score||0) + (ok? +5 : -8),
    } : e);
    save(eps);
  };

  if (method !== "GET" && method !== "HEAD") {
    let last: any;
    for (const e of eps) {
      const t0 = performance.now();
      try {
        const res = await fetch(e.base + path, {
          ...(opt.init||{}),
          method,
          headers: { ...(opt.init?.headers||{}), "Idempotency-Key": crypto.randomUUID() },
        });
        upd(e.base, res.ok, performance.now()-t0);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (err) { last = err; upd(e.base, false); }
    }
    throw last || new Error("all endpoints failed");
  }

  const [p,s] = [eps[0], eps[1]];
  if (!s) {
    const t0 = performance.now();
    const r = await fetch(p.base + path, { ...(opt.init||{}), method });
    upd(p.base, r.ok, performance.now()-t0);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  }

  const hedgeDelay = opt.hedgeDelayMs ?? 120;
  const c1 = new AbortController(), c2 = new AbortController();
  const f1 = (async()=>{
    const t0 = performance.now();
    const r = await fetch(p.base + path, { ...(opt.init||{}), method, signal: c1.signal });
    return { base:p.base, r, rtt: performance.now()-t0 };
  })();
  const f2 = (async()=>{
    await new Promise(r=>setTimeout(r, hedgeDelay));
    const t0 = performance.now();
    const r = await fetch(s.base + path, { ...(opt.init||{}), method, signal: c2.signal });
    return { base:s.base, r, rtt: performance.now()-t0 };
  })();

  try {
    const first = await Promise.race([f1,f2]);
    (first.base===p.base ? c2 : c1).abort();
    upd(first.base, first.r.ok, first.rtt);
    if (!first.r.ok) throw new Error(`HTTP ${first.r.status}`);
    return first.r;
  } catch (e) {
    c1.abort(); c2.abort();
    for (let i=2;i<eps.length;i++){
      const t0 = performance.now();
      try {
        const r = await fetch(eps[i].base + path, { ...(opt.init||{}), method });
        upd(eps[i].base, r.ok, performance.now()-t0);
        if (r.ok) return r;
      } catch { upd(eps[i].base, false); }
    }
    throw e;
  }
}
```

**使用**

```ts
const res = await smartFetch("/v1/data?x=1", {
  endpoints: [
    "https://api-a.example.com",
    "https://api-b.example.com",
    "https://api-c.example.com",
  ],
  method: "GET",
});
```

> [!note] 鉴权与 CORS  
> 跨域场景下建议使用 **Bearer/JWT**（`Authorization` 头），避免 Cookie 跨域带来的复杂度。后端需允许你的前端站点域名与相关头部。

---

### 4.2 Android（Java / OkHttp）

**关键点**

- 通过 **自定义 `Dns`** 影响同一域名解析出来的多 IP 的使用顺序；
    
- **对冲**用于 GET/HEAD，**顺序重试**用于写请求；
    
- 用 `SharedPreferences` 持久化每个 IP 的 RTT/失败信息，持续自优化。
    

**最小可用：`SmartDns` + `HedgedCall`**

```java
// SmartDns.java
import okhttp3.Dns;
import java.net.*;
import java.util.*;
import android.content.*;

public final class SmartDns implements Dns {
  private final Context ctx;
  private static final String SP = "smart_dns_v1";

  public SmartDns(Context ctx) { this.ctx = ctx.getApplicationContext(); }

  @Override public List<InetAddress> lookup(String hostname) throws UnknownHostException {
    List<InetAddress> all = Arrays.asList(InetAddress.getAllByName(hostname));
    SharedPreferences sp = ctx.getSharedPreferences(SP, Context.MODE_PRIVATE);
    List<InetAddress> sorted = new ArrayList<>(all);
    sorted.sort((a,b)->{
      long ra = sp.getLong(hostname+"|"+a.getHostAddress(), Long.MAX_VALUE/2);
      long rb = sp.getLong(hostname+"|"+b.getHostAddress(), Long.MAX_VALUE/2);
      return Long.compare(ra, rb);
    });
    return sorted;
  }

  public void report(String host, InetAddress ip, long rttMs, boolean ok) {
    SharedPreferences sp = ctx.getSharedPreferences(SP, Context.MODE_PRIVATE);
    long cur = Math.max(1, sp.getLong(host+"|"+ip.getHostAddress(), rttMs));
    long next = ok ? (cur*7 + rttMs*3)/10 : cur + 50;
    sp.edit().putLong(host+"|"+ip.getHostAddress(), next).apply();
  }
}
```

```java
// HedgedCall.java
import okhttp3.*;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;

public final class HedgedCall {
  private final OkHttpClient client;
  private final List<HttpUrl> bases;
  private final long hedgeDelayMs;

  public HedgedCall(OkHttpClient baseClient, Dns dns, List<String> baseUrls, long hedgeDelayMs) {
    this.client = baseClient.newBuilder().dns(dns).retryOnConnectionFailure(true).build();
    this.bases = baseUrls.stream().map(HttpUrl::get).toList();
    this.hedgeDelayMs = hedgeDelayMs;
  }

  private Request rebuild(Request orig, HttpUrl base) {
    HttpUrl u = orig.url().newBuilder()
        .scheme(base.scheme()).host(base.host()).port(base.port()).build();
    return orig.newBuilder().url(u).build();
  }

  public Response execute(Request req) throws IOException {
    String m = req.method().toUpperCase();
    if (!m.equals("GET") && !m.equals("HEAD")) {
      IOException last = null;
      for (HttpUrl b : bases) {
        Request r = req.newBuilder()
            .url(rebuild(req, b).url())
            .header("Idempotency-Key", java.util.UUID.randomUUID().toString())
            .build();
        try (Response resp = client.newCall(r).execute()) {
          if (resp.isSuccessful()) return resp;
          last = new IOException("HTTP "+resp.code());
        } catch (IOException e) { last = e; }
      }
      throw last!=null? last : new IOException("all endpoints failed");
    }

    if (bases.size()==1) return client.newCall(rebuild(req, bases.get(0))).execute();

    Call c1 = client.newCall(rebuild(req, bases.get(0)));
    Call c2 = client.newCall(rebuild(req, bases.get(1)));
    CompletableFuture<Response> f = new CompletableFuture<>();

    new Thread(() -> { try { f.complete(c1.execute()); } catch (IOException e) { f.completeExceptionally(e);} }).start();
    new Thread(() -> {
      try { Thread.sleep(hedgeDelayMs); f.complete(c2.execute()); } catch (Exception ignored) {}
    }).start();

    try {
      Response got = f.get();
      if (got.request().url().host().equals(bases.get(0).host())) c2.cancel(); else c1.cancel();
      if (!got.isSuccessful()) throw new IOException("HTTP "+got.code());
      return got;
    } catch (Exception e) {
      c1.cancel(); c2.cancel();
      IOException last = e instanceof IOException ? (IOException)e : new IOException(e);
      for (int i=2;i<bases.size();i++){
        try (Response r = client.newCall(rebuild(req, bases.get(i))).execute()){
          if (r.isSuccessful()) return r;
          last = new IOException("HTTP "+r.code());
        } catch (IOException ex) { last = ex; }
      }
      throw last;
    }
  }
}
```

**使用**

```java
OkHttpClient ok = new OkHttpClient.Builder().build();
SmartDns dns = new SmartDns(appContext);
HedgedCall hc = new HedgedCall(ok, dns,
  List.of("https://api-a.example.com","https://api-b.example.com"), 120);

Request req = new Request.Builder().url("https://placeholder/v1/healthz").get().build();
Response resp = hc.execute(req);
```

> [!tip] 进阶  
> 使用 OkHttp `EventListener` 可拿到连接 IP 与时延，配合 `SmartDns.report()` 做更精确的 IP 级打分。

---

### 4.3 iOS（Swift / URLSession）

**关键点**

- `URLSession` + `TaskGroup` 实现 GET/HEAD 的对冲；
    
- 写操作顺序重试并携带 `Idempotency-Key`；
    
- 需要同域多 IP 排序时，可引入 `Network` 框架（`NWResolver`/`NWConnection`）做自定义解析策略（进阶）。
    

**最小可用：`SmartClient`**

```swift
import Foundation

struct Endpoint { let base: URL }

final class SmartClient {
    private let session = URLSession(configuration: .default)
    private var eps: [Endpoint]
    private let hedgeDelayMs: UInt64

    init(endpoints: [URL], hedgeDelayMs: UInt64 = 120) {
        self.eps = endpoints.map { Endpoint(base: $0) }
        self.hedgeDelayMs = hedgeDelayMs
    }

    // 写：顺序一次 + 幂等键
    func sendWrite(path: String, body: Data?, method: String = "POST") async throws -> (Data, URLResponse) {
        var last: Error?
        for e in eps {
            var req = URLRequest(url: e.base.appendingPathComponent(path))
            req.httpMethod = method
            req.httpBody = body
            req.addValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
            do {
                let r = try await session.data(for: req)
                if let http = r.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode) { return r }
                else { throw URLError(.badServerResponse) }
            } catch { last = error }
        }
        throw last ?? URLError(.cannotConnectToHost)
    }

    // 读：对冲 + 回退
    func fetch(path: String) async throws -> (Data, URLResponse) {
        if eps.count == 1 {
            var r = URLRequest(url: eps[0].base.appendingPathComponent(path)); r.httpMethod = "GET"
            return try await session.data(for: r)
        }
        let a = eps[0], b = eps[1]
        return try await withThrowingTaskGroup(of: (Data, URLResponse).self) { group in
            group.addTask {
                var r = URLRequest(url: a.base.appendingPathComponent(path)); r.httpMethod = "GET"
                return try await self.session.data(for: r)
            }
            group.addTask {
                try await Task.sleep(nanoseconds: self.hedgeDelayMs * 1_000_000)
                var r = URLRequest(url: b.base.appendingPathComponent(path)); r.httpMethod = "GET"
                return try await self.session.data(for: r)
            }
            do {
                let first = try await group.next()!
                group.cancelAll()
                if let http = first.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode) { return first }
                else { throw URLError(.badServerResponse) }
            } catch {
                group.cancelAll()
                for i in 2..<self.eps.count {
                    var r = URLRequest(url: self.eps[i].base.appendingPathComponent(path)); r.httpMethod = "GET"
                    do {
                        let got = try await self.session.data(for: r)
                        if let http = got.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode) { return got }
                    } catch { /* continue */ }
                }
                throw error
            }
        }
    }
}
```

---

## 5. 集成清单（Checklist）

-  准备至少 **2–3 个可用域名**（Web 必须满足 CORS；原生端同域多 IP 亦可利用）。
    
-  保留/新增轻量 `GET/HEAD /healthz`（200 即可），用于端内测速。
    
-  **读请求**：开启**对冲**（建议 `hedgeDelay` 80–150ms；弱网环境可再调大）。
    
-  **写请求**：携带 **Idempotency-Key**，失败换线路重试一次。
    
-  **持久化打分**：Web `localStorage` / Android `SharedPreferences` / iOS `UserDefaults`。
    
-  **鉴权**：跨域建议 **Bearer/JWT**；Cookie 仅在同父域 `Domain=.example.com` 场景使用。
    
-  **可观测**：上报线路、RTT、HTTP 码、切换次数、失败类别、对冲触发次数。
    
-  **超时设置**：单次连接/读超时合理收敛（如连接 2–3s、读 6–10s），避免长时间挂起。
    

---

## 6. 参数与策略建议

- **Hedge Delay**：80–150ms（以 P99 与额外带宽成本为边界调优）。
    
- **重试上限**：写操作最多 1 次跨线路重试；读操作对冲 + 最多尝试剩余线路各 1 次。
    
- **EMA 系数**：`rtt = rtt*0.7 + new*0.3`；失败扣分 ≥ 成功加分的 1.5 倍。
    
- **衰减**：按时间对历史分数做轻度衰减，避免旧评分“粘滞”。
    
- **降级**：连续失败阈值（如 3 次）后，暂时降低该线路优先级，过一段时间再试探性恢复。
    

---

## 7. 失败模式与应对

- **DNS 污染/网络劣化**：多域名对冲能绕过单点异常；原生端可利用自定义 DNS 排序。
    
- **证书问题**：只使用带有效证书的域名；不要尝试 IP 直连 HTTPS。
    
- **CORS 拦截**（Web）：确认服务端允许源站与必要头部（如 `Authorization`）。
    
- **写操作重复**：严格依赖 **Idempotency-Key** 去重，后端窗口建议 5–10 分钟。
    
- **门户网络/时间偏差**：对 302/重定向的处理要谨慎；系统时间严重偏差会导致 TLS 失败。
    

---

## 8. `/healthz` 与后端协定（尽量简单）

- `GET /healthz` 或 `HEAD /healthz`：
    
    - 返回 `200`；可返回极简文本或空体；
        
    - 不必暴露内部依赖，但建议能基本代表实例可用。
        
- **鉴权**：`/healthz` 不需要鉴权，避免对冲/测速阶段的干扰。
    
- **缓存**：加 `Cache-Control: no-store`（或端侧请求加 `cache: "no-store"`）。
    

---

## 9. 常见问答（精简）

- **Q：不加 LB/DNS，纯客户端能做到“最优线路”吗？**  
    A：能在**多个域名**间做到择优与快速切换；原生端还能在**同域多 IP**间做排序与回退。
    
- **Q：能 0 代价解决 Cookie 跨域吗？**  
    A：不能。跨主域建议改用 **Bearer/JWT**。
    
- **Q：对冲会增加后端压力吗？**  
    A：会增加少量并发请求（通常只在慢/抖动时触发），必要时仅对关键 GET 开启，对写操作禁用。
    

---

## 10. 最小落地步骤（30 分钟拿到初效）

1. 为各端注入**候选域名列表**；
    
2. 前端/客户端接入 **smartFetch / HedgedCall / SmartClient**；
    
3. 后端暴露/确认 **`/healthz`**；
    
4. 写操作添加 **Idempotency-Key** 去重支持；
    
5. 开启埋点：线路、RTT、失败、切换；
    
6. 预设：`hedgeDelay = 120ms`，连接超时 2–3s，读超时 8–10s；一周后据埋点调参。
    

---

## 11. 代码清单快速索引

- Web：`smartFetch.ts`（对冲 + 顺序回退 + 持久化打分）
    
- Android：`SmartDns.java`、`HedgedCall.java`（同域多 IP 可控 + 对冲 + 幂等重试）
    
- iOS：`SmartClient.swift`（对冲 + 顺序回退 + 幂等重试）
    

---

## 12. 风险提示

> [!warning]
> 
> - 纯客户端方案无法完全替代服务端 GSLB/Anycast 的全球调度能力；
>     
> - 跨域鉴权、Cookie 策略、证书管理的复杂度会上移到客户端；
>     
> - 对冲策略不宜滥用，需结合埋点逐步调优触发条件与比例。
>     

---

## 13. 总结

在不改现有架构的前提下，通过**端侧的线路池 + 对冲读取 + 幂等写重试 + 打分持久化**，可显著提高 API 调用的**可用性与稳定性**。  
Web 侧靠**多域名切换**，原生端同时利用**同域多 IP 排序**，配合最小 `/healthz` 与基础埋点，就能在复杂网络环境中维持稳定的用户体验。