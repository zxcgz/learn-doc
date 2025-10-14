
> 适用于：n8n `1.110.x`（以及同类版本）、钉钉自定义机器人（Webhook/可选加签）。  
> 本文面向 Obsidian，纯 Markdown，可直接存入知识库。

---

## 🎯 目标功能
- **Cron** 精准控制发送时间（支持 5/6 段表达式、DOM/DOW OR 语义）。
- **工作日判断**：自动识别中国法定**节假日**与**调休上班**（数据源：`holiday-cn`），普通工作日自动兜底。
- **本地缓存**：使用 `getWorkflowStaticData`（workflow static data）缓存日历数据，**减少外网请求**。
- **DingTalk Markdown**：可点链接（自动补协议/转义），**@全员** 可靠生效。
- **加签**（可选）：兼容钉钉安全设置。
- **随机文案**：emoji/quote/tip 随机，模板可扩展。

---

## 🧩 工作流总览（建议的节点顺序）

```text
Schedule Trigger (每分钟/更细粒度) 
    → Cron: Config (Set)                  # 配置 cron、timezone、markdown、link等
    → Cron Gate (Function)                # ★ 顶层拦截：不命中 cron 直接 return []
    → CN Workday Cache (Code)             # 读缓存判断 need_fetch（只看 TTL）
    → IF need_fetch (可选)                # 命中 true 才去拉年表（或者改用 Gate）
        ├─true→ Holiday CN (Y) – HTTP → Holiday CN (Y+1) – HTTP → Save Workday Cache (Code)
        └─false──────────────────────────────────────────────┐
                                                             ↓
                                            Build DingTalk Payload (Cron)
                                                     → Send to DingTalk (HTTP)
```

> **强烈建议**：所有通往“发送 HTTP”的路径都必须经过 **Cron Gate**（或其等效拦截）与 **Build**，避免“旁路直达发送节点”。

---

## ⚙️ 节点配置要点

### 1) `Cron: Config (Set)`（只保留自己要改的字段即可）
- `cron`: 例如 `0 18 * * 1-5`（每个工作日 18:00）或 `0 12 * * *`（每日 12:00）。
- `timezone`: 例如 `Asia/Shanghai`（或 `Asia/Tokyo`）。
- `dingtalk_webhook_url`: 你的钉钉机器人 Webhook。
- `dingtalk_secret`: 机器人开启加签时所需（未开启可留空）。
- `markdown`/`link_title`/`link_url`/`at_all` 等。

> **变量读取**：后续代码通过 `$items("Cron: Config (Set)")[0].json` 获取。确保 **Cron: Config (Set)** 正确连到后面的节点。

---

## 🛑 顶层拦截：`Cron Gate (Function)`（放在最前面）

> 推荐**复用你已有的「Cron Match? (Function)」节点**，直接把下面这段代码**替换**原代码即可。  
> 逻辑：**命中 cron 才放行**；不匹配就 `return []`，彻底阻断后续节点。

```js
/**
 * Cron Gate (Function) — 顶层拦截
 * 读取上游 Set 的 $json.cron / $json.timezone
 * 5 或 6 段 cron；DOM/DOW 采用 OR 语义；支持 MON..SUN 名称；支持 */步长、范围、列表。
 * 匹配失败 → return [] 直接阻断后续节点。
 */

function matchPart(v, expr) {
  const s = String(expr || '').trim();
  if (s === '*') return true;
  const items = s.split(',');
  for (let i = 0; i < items.length; i++) {
    const t = items[i].trim();
    if (t === '*') return true;
    if (t.startsWith('*/')) { const step = parseInt(t.slice(2), 10) || 1; if ((v % step) === 0) return true; continue; }
    if (t.includes('-')) { const ab = t.split('-'); const a = parseInt(ab[0],10), b = parseInt(ab[1],10); if (v >= a && v <= b) return true; continue; }
    if (v === parseInt(t,10)) return true;
  }
  return false;
}

function cronMatchNow(cron, tz) {
  const tokens = String(cron || '').trim().split(/\s+/).filter(Boolean);
  if (!(tokens.length === 5 || tokens.length === 6)) return false;

  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Asia/Shanghai',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parseInt(parts.find(x => x.type === t).value, 10);
  const sec  = get('second');
  const min  = get('minute');
  const hour = get('hour');
  const day  = get('day');
  const mon  = get('month');
  const mapW = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  const dow  = mapW[parts.find(x => x.type === 'weekday').value];

  const hasSec = tokens.length === 6;
  const [secE, minE, hourE, domE, monE, dowE0] = hasSec ? tokens : ['*', tokens[0], tokens[1], tokens[2], tokens[3], tokens[4]];

  const dowE = String(dowE0).toUpperCase()
    .replace(/\bSUN\b/g,'0').replace(/\bMON\b/g,'1').replace(/\bTUE\b/g,'2')
    .replace(/\bWED\b/g,'3').replace(/\bTHU\b/g,'4').replace(/\bFRI\b/g,'5')
    .replace(/\bSAT\b/g,'6').replace(/\b7\b/g,'0');

  const secOk  = matchPart(sec,  secE);
  const minOk  = matchPart(min,  minE);
  const hourOk = matchPart(hour, hourE);
  const monOk  = matchPart(mon,  monE);
  const domOk  = matchPart(day,  domE);
  const dowOk  = matchPart(dow,  dowE);

  // DOM 与 DOW 采用 OR 语义（标准 crontab 行为）
  const domStar = String(domE).trim() === '*';
  const dowStar = String(dowE).trim() === '*';
  let dayOk;
  if (!domStar && !dowStar) dayOk = domOk || dowOk;
  else if (!domStar)        dayOk = domOk;
  else if (!dowStar)        dayOk = dowOk;
  else                      dayOk = true;

  return secOk && minOk && hourOk && monOk && dayOk;
}

// ====== 从上游 Set 读取 cron/timezone ======
const cron = String($json.cron || '').trim();
const tz   = String($json.timezone || 'Asia/Shanghai').trim();

// 严格模式：未配置 cron 就直接阻断，避免误发（如需放行，把 STRICT 改为 false）
const STRICT = true;
if (!cron) {
  if (STRICT) return [];
}

// 命中才放行；不命中直接阻断
if (!cronMatchNow(cron, tz)) {
  return [];
}

// 通过 → 透传当前数据给后续节点
return [{ json: $json }];
```

---

## 🧠 缓存读取：`CN Workday Cache (Code)`（方案A，整段替换）

```js
// === CN Workday Cache (Code) ===

function getStatic(scope='global'){
  try {
    return typeof getWorkflowStaticData === 'function'
      ? getWorkflowStaticData(scope)
      : (this && this.getWorkflowStaticData ? this.getWorkflowStaticData(scope) : {});
  } catch { return {}; }
}
function ymdInTZ(d, tz) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit'
  }).format(d);
}

const tzCN = 'Asia/Shanghai';
const nowMs = Date.now();
const ymd = ymdInTZ(new Date(), tzCN);
const year = ymd.slice(0,4);
const yearNext = String(Number(year) + 1);

const sd = getStatic('global');
sd.__cnDayTypes = sd.__cnDayTypes || {};
sd.__cnDayMeta  = sd.__cnDayMeta  || {};
sd.__cnYearMeta = sd.__cnYearMeta || {};
sd.__cnLastFetchedAt = sd.__cnLastFetchedAt || 0;

const ttlHours = parseInt(($json.calendar_cache_ttl_hours || 168), 10) || 168;
const ttlMs = ttlHours * 3600 * 1000;

const dayMeta   = sd.__cnDayMeta[ymd];
const yearMeta  = sd.__cnYearMeta[year];
const lastFetch = sd.__cnLastFetchedAt || 0;

let hit = null;
if (dayMeta?.fetchedAt && (nowMs - dayMeta.fetchedAt) < ttlMs) hit = 'day';
else if (yearMeta?.fetchedAt && (nowMs - yearMeta.fetchedAt) < ttlMs) hit = 'year';
else if (lastFetch && (nowMs - lastFetch) < ttlMs) hit = 'global';

const need_fetch = (hit === null);
const today_type_cached = sd.__cnDayTypes[ymd]; // 普通工作日可能为 undefined

return [{
  json: {
    ...$json,
    today_ymd: ymd,
    today_year: year,
    next_year: yearNext,
    need_fetch,
    today_type_cached,
    cache_debug: {
      hit_source: hit,
      day_meta: dayMeta || null,
      year_meta: yearMeta || null,
      last_fetched_at: lastFetch || null,
      ttl_ms: ttlMs
    }
  }
}];
```

---

## 💾 缓存写入：`Save Workday Cache (Code)`（方案B，整段替换）

```js
// === Save Workday Cache (Code) ===

function getStatic(scope='global'){
  try {
    return typeof getWorkflowStaticData === 'function'
      ? getWorkflowStaticData(scope)
      : (this && this.getWorkflowStaticData ? this.getWorkflowStaticData(scope) : {});
  } catch { return {}; }
}
function ymdInTZ(d, tz='Asia/Shanghai'){
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit'
  }).format(d);
}
function isWeekendCN(d=new Date()){
  const w = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', weekday:'short' }).format(d);
  return (w === 'Sat' || w === 'Sun');
}
function readItemsJson(name) {
  const arr = $items(name) || [];
  return (arr[0] && arr[0].json) ? arr[0].json : null;
}

const sd = getStatic('global');
sd.__cnDayTypes = sd.__cnDayTypes || {}; // { 'YYYY-MM-DD': 0/1/2/3 }
sd.__cnDayMeta  = sd.__cnDayMeta  || {}; // { 'YYYY-MM-DD': { fetchedAt } }
sd.__cnYearMeta = sd.__cnYearMeta || {}; // { 'YYYY': { fetchedAt } }
sd.__cnLastFetchedAt = sd.__cnLastFetchedAt || 0;

const nowTs = Date.now();
const ymd = $json.today_ymd || ymdInTZ(new Date());
const year = String($json.today_year || '').trim();
const nextYear = String($json.next_year || '').trim();

// 兼容 3 种名字（— / - / 空格）
const yJson  = readItemsJson('Holiday CN (Y) – HTTP') || readItemsJson('Holiday CN (Y) - HTTP') || readItemsJson('Holiday CN (Y) HTTP');
const y1Json = readItemsJson('Holiday CN (Y+1) – HTTP') || readItemsJson('Holiday CN (Y+1) - HTTP') || readItemsJson('Holiday CN (Y+1) HTTP');

function writeYear(yearStr, data){
  if (!data || !Array.isArray(data.days)) return;
  for (let i=0; i<data.days.length; i++){
    const d = data.days[i];
    const day = String(d.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    // isOffDay: true=2(节休)，false=3(调休上班)
    sd.__cnDayTypes[day] = (d.isOffDay ? 2 : 3);
  }
  if (yearStr) sd.__cnYearMeta[yearStr] = { fetchedAt: nowTs };
}
if (yJson)  writeYear(year,     yJson);
if (y1Json) writeYear(nextYear, y1Json);

// 计算今天类型，年表没覆盖则按周末=1/工作日=0
let t = sd.__cnDayTypes[ymd];
if (typeof t === 'undefined') t = isWeekendCN(new Date()) ? 1 : 0;

// 写今天的类型 & meta & 全局 lastFetchedAt
sd.__cnDayTypes[ymd] = t;
sd.__cnDayMeta[ymd]  = { fetchedAt: nowTs };
sd.__cnLastFetchedAt = nowTs;

// 可选：清理历史（~800天）
(function prune(){
  const keys = Object.keys(sd.__cnDayTypes).sort();
  const cutoff = ymdInTZ(new Date(Date.now() - 800*24*3600*1000));
  for (const k of keys) if (k < cutoff) delete sd.__cnDayTypes[k];
})();

return [{
  json: {
    ...$json,
    today_type: t,
    cache_debug: {
      ymd,
      years_cached: Object.keys(sd.__cnYearMeta || {}),
      dayTypes_count: Object.keys(sd.__cnDayTypes || {}).length,
      today_meta: sd.__cnDayMeta ? sd.__cnDayMeta[ymd] : null,
      last_fetched_at: sd.__cnLastFetchedAt || null,
      got_Y:  !!(yJson && Array.isArray(yJson.days)),
      got_Y1: !!(y1Json && Array.isArray(y1Json.days))
    }
  }
}];
```

---

## 🌐 节假日数据源（HTTP 节点）
- Year：`https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{{ $json.today_year }}.json`
- Year+1：`https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{{ $json.next_year }}.json`
- 配置：`Response Format: JSON`、`Timeout: 15000`、UA/Accept 头。

---

## 🔐 加签 & 环境
- 若启用加签：`NODE_FUNCTION_ALLOW_BUILTIN=crypto`（n8n 运行环境）。

---

## ✅ 测试与排查
- Gate 未命中 → 节点输出 `0 items`，后续不执行。
- 第二次执行开始：`need_fetch=false`（或 `hit_source` 为 `day/year/global`）。
- 发送不应被“旁路直接连到 HTTP”。
- 手动执行后**记得保存**（未保存=缓存未持久化）；Active 模式会自动持久化。

---
下面提供一个几乎可以直接可以使用的文件
![[推送写日志消息到钉钉（考虑节假日版） (1).json]]在使用时，替换hook_url和secret_key即可