适用于以 **Spring Boot 打包为 JAR** 运行的服务，涵盖 `@CrossOrigin` 注解、全局配置（MVC/WebFlux）、Spring Security 6（Boot 3）集成、**读取配置文件+默认值+开关**，以及验证与排错方法。

---

## 适用范围与前提

- Spring Boot 2.x/3.x；以 **JAR** 方式运行。
- MVC 场景使用 `spring-boot-starter-web`；Reactive 场景使用 `spring-boot-starter-webflux`。
- 若启用 Spring Security，请同步配置 `http.cors(...)`。

---

## 一、最快方案（局部注解）

> 适合单个或少量接口临时开放。生产建议使用全局方案或集中配置。

```java
@RestController
@RequestMapping("/api")
@CrossOrigin(
  // 固定域名或模式。注意：originPatterns 支持主机通配，不支持端口通配
  originPatterns = {"http://localhost:5173", "https://*.example.com"},
  allowedHeaders = "*",
  methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE, RequestMethod.OPTIONS},
  allowCredentials = "true",
  maxAge = 3600
)
public class DemoController {
  @GetMapping("/ping")
  public String ping() { return "pong"; }
}
```

要点：
- 需要携带 Cookie/Authorization 时，**不能**同时使用 `allowedOrigins("*")`；应回显具体 Origin，或使用 `allowedOriginPatterns` 通配域名。  
- `originPatterns` **不支持端口**通配（`http://localhost:*` 无效）。需要枚举端口。

---

## 二、全局方案（Spring MVC）

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {
  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/**")
      .allowedOriginPatterns("http://localhost:5173", "https://*.example.com")
      .allowedMethods("GET","POST","PUT","DELETE","OPTIONS")
      .allowedHeaders("*")
      .exposedHeaders("Content-Disposition")
      .allowCredentials(true)
      .maxAge(3600);
  }
}
```

---

## 三、启用 Spring Security 6（Boot 3）时的配置

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
  @Bean
  SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
      .cors(Customizer.withDefaults())                 // 开启 CORS
      .csrf(csrf -> csrf.disable())
      .authorizeHttpRequests(auth -> auth
        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()  // 放行预检
        .anyRequest().permitAll()                                  // 视业务调整
      );
    return http.build();
  }
}
```

> 若使用 `CorsConfigurationSource`（见第四节的桥接配置），`http.cors(Customizer.withDefaults())` 会自动采用该配置。

---

## 四、从配置文件读取（可开关、带默认值）——推荐

### application.yml

```yaml
app:
  cors:
    enabled: true                          # 全局开关，false 时不注册任何 CORS 规则
    path-patterns: ["/**"]
    origin-patterns:
      - "http://localhost:5173"
      - "https://*.example.com"
    allowed-origins: []                    # 与 origin-patterns 二选一
    allowed-methods: ["GET","POST","PUT","DELETE","OPTIONS"]
    allowed-headers: ["*"]
    exposed-headers: ["Content-Disposition"]
    allow-credentials: true
    max-age: 3600
```

### CorsProperties.java

```java
package your.pkg.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@ConfigurationProperties(prefix = "app.cors")
public class CorsProperties {

    private boolean enabled = true;
    private List<String> pathPatterns = new ArrayList<>(List.of("/**"));
    private List<String> originPatterns = new ArrayList<>(Arrays.asList(
            "http://localhost:5173", "https://*.example.com"
    ));
    private List<String> allowedOrigins = new ArrayList<>();
    private List<String> allowedMethods = new ArrayList<>(Arrays.asList(
            "GET","POST","PUT","DELETE","OPTIONS"
    ));
    private List<String> allowedHeaders = new ArrayList<>(List.of("*"));
    private List<String> exposedHeaders = new ArrayList<>(List.of("Content-Disposition"));
    private boolean allowCredentials = true;
    private long maxAge = 3600L;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public List<String> getPathPatterns() { return pathPatterns; }
    public void setPathPatterns(List<String> pathPatterns) { this.pathPatterns = pathPatterns; }
    public List<String> getOriginPatterns() { return originPatterns; }
    public void setOriginPatterns(List<String> originPatterns) { this.originPatterns = originPatterns; }
    public List<String> getAllowedOrigins() { return allowedOrigins; }
    public void setAllowedOrigins(List<String> allowedOrigins) { this.allowedOrigins = allowedOrigins; }
    public List<String> getAllowedMethods() { return allowedMethods; }
    public void setAllowedMethods(List<String> allowedMethods) { this.allowedMethods = allowedMethods; }
    public List<String> getAllowedHeaders() { return allowedHeaders; }
    public void setAllowedHeaders(List<String> allowedHeaders) { this.allowedHeaders = allowedHeaders; }
    public List<String> getExposedHeaders() { return exposedHeaders; }
    public void setExposedHeaders(List<String> exposedHeaders) { this.exposedHeaders = exposedHeaders; }
    public boolean isAllowCredentials() { return allowCredentials; }
    public void setAllowCredentials(boolean allowCredentials) { this.allowCredentials = allowCredentials; }
    public long getMaxAge() { return maxAge; }
    public void setMaxAge(long maxAge) { this.maxAge = maxAge; }
}
```

### CorsConfig.java（MVC 全局）

```java
package your.pkg.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.CollectionUtils;
import org.springframework.web.servlet.config.annotation.CorsRegistration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration
@EnableConfigurationProperties(CorsProperties.class)
public class CorsConfig implements WebMvcConfigurer {

    private final CorsProperties props;

    public CorsConfig(CorsProperties props) {
        this.props = props;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        if (!props.isEnabled()) {
            return; // 未启用 CORS
        }
        List<String> paths = props.getPathPatterns();
        if (CollectionUtils.isEmpty(paths)) {
            paths = List.of("/**");
        }
        for (String path : paths) {
            CorsRegistration reg = registry.addMapping(path)
                .allowedMethods(props.getAllowedMethods().toArray(new String[0]))
                .allowedHeaders(props.getAllowedHeaders().toArray(new String[0]))
                .exposedHeaders(props.getExposedHeaders().toArray(new String[0]))
                .allowCredentials(props.isAllowCredentials())
                .maxAge(props.getMaxAge());

            if (!CollectionUtils.isEmpty(props.getOriginPatterns())) {
                reg.allowedOriginPatterns(props.getOriginPatterns().toArray(new String[0]));
            } else if (!CollectionUtils.isEmpty(props.getAllowedOrigins())) {
                reg.allowedOrigins(props.getAllowedOrigins().toArray(new String[0]));
            }
        }
    }
}
```

### SecurityCorsBridgeConfig.java（与 Security 共用规则）

```java
package your.pkg.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.CollectionUtils;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
public class SecurityCorsBridgeConfig {

    private final CorsProperties props;

    public SecurityCorsBridgeConfig(CorsProperties props) {
        this.props = props;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        if (!props.isEnabled()) {
            return request -> null;
        }
        CorsConfiguration cfg = new CorsConfiguration();
        if (!CollectionUtils.isEmpty(props.getOriginPatterns())) {
            cfg.setAllowedOriginPatterns(props.getOriginPatterns());
        } else if (!CollectionUtils.isEmpty(props.getAllowedOrigins())) {
            cfg.setAllowedOrigins(props.getAllowedOrigins());
        }
        cfg.setAllowedMethods(props.getAllowedMethods());
        cfg.setAllowedHeaders(props.getAllowedHeaders());
        cfg.setExposedHeaders(props.getExposedHeaders());
        cfg.setAllowCredentials(props.isAllowCredentials());
        cfg.setMaxAge(props.getMaxAge());

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        List<String> paths = props.getPathPatterns();
        if (CollectionUtils.isEmpty(paths)) {
            paths = List.of("/**");
        }
        for (String p : paths) {
            source.registerCorsConfiguration(p, cfg);
        }
        return source;
    }
}
```

> Security 侧的 `SecurityFilterChain` 需包含：
>
> ```java
> http.cors(Customizer.withDefaults())
>     .csrf(csrf -> csrf.disable())
>     .authorizeHttpRequests(auth -> auth
>         .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
>         .anyRequest().permitAll()
>     );
> ```

---

## 五、WebFlux 与 Spring Cloud Gateway

**WebFlux：**

```java
@Configuration
public class WebFluxCorsConfig {

  @Bean
  public CorsWebFilter corsWebFilter() {
    CorsConfiguration cfg = new CorsConfiguration();
    cfg.setAllowedOriginPatterns(List.of("http://localhost:5173","https://*.example.com"));
    cfg.setAllowedMethods(List.of("GET","POST","PUT","DELETE","OPTIONS"));
    cfg.setAllowedHeaders(List.of("*"));
    cfg.setExposedHeaders(List.of("Content-Disposition"));
    cfg.setAllowCredentials(true);
    cfg.setMaxAge(3600L);

    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", cfg);
    return new CorsWebFilter(source);
  }
}
```

**Spring Cloud Gateway（`application.yml`）：**

```yaml
spring:
  cloud:
    gateway:
      globalcors:
        add-to-simple-url-handler-mapping: true
        corsConfigurations:
          '[/**]':
            allowedOriginPatterns: "http://localhost:5173,https://*.example.com"
            allowedMethods: "GET,POST,PUT,DELETE,OPTIONS"
            allowedHeaders: "*"
            exposedHeaders: "Content-Disposition"
            allowCredentials: true
            maxAge: 3600
```

---

## 六、如何验证是否生效

### 1) 浏览器 DevTools
- Network 面板 → 触发跨域请求（XHR/Fetch）。
- 预检（OPTIONS）应返回 `200/204`，并包含：
  - `Access-Control-Allow-Origin: <你的域>`
  - `Access-Control-Allow-Methods: ...`
  - `Access-Control-Allow-Headers: ...`
  - （如需）`Access-Control-Allow-Credentials: true`
- 实际请求响应也应包含 `Access-Control-Allow-Origin`。

### 2) `curl` 预检与实际请求
把 URL/Origin 换成你的：

**预检：**
```bash
curl -i -X OPTIONS "https://api.example.com/api/ping" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization"
```

**实际：**
```bash
curl -i "https://api.example.com/api/ping" \
  -H "Origin: http://localhost:5173"
```

期望看到：`Access-Control-Allow-Origin` 回显为具体域名，必要时含 `Access-Control-Allow-Credentials: true`。

### 3) 前端最小自测
```js
fetch("https://api.example.com/api/ping", {
  method: "GET",
  credentials: "include",
  headers: { "Content-Type": "application/json" }
}).then(r => {
  console.log("ok?", r.ok, "status=", r.status);
  console.log("Content-Disposition =", r.headers.get("Content-Disposition"));
  return r.text();
}).then(console.log).catch(console.error);
```

---

## 七、常见问题与解决

- **`allowCredentials(true)` 与 `"*"` 冲突**：携带凭证时禁止 `Access-Control-Allow-Origin: *`，必须回显具体域名或使用 `allowedOriginPatterns`。
- **端口通配无效**：`originPatterns` 仅支持主机名通配，**不支持端口**（`http://localhost:*` 无效）。需要显式列出端口。
- **预检 403/401**：
  - Security 未放行 `OPTIONS`；添加 `requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()`。
  - 未启用 `http.cors(...)`。
  - `Access-Control-Request-Headers` 包含的头未被允许。
- **SameSite 导致跨站 Cookie 不带**：需要 `SameSite=None; Secure` 且 HTTPS，前端 `credentials:"include"`。
- **代理/网关覆盖响应头**：确认未被 Nginx/Gateway 去除/改写 `Access-Control-*`。
- **预检缓存**：调整 `maxAge`；变更策略后建议在无痕窗口复测。
- **路径未匹配到规则**：确认 `addCorsMappings` 的路径模式覆盖了实际接口。

---

## 八、日志定位（打开调试）

`application.yml`：

```yaml
logging:
  level:
    org.springframework.web.cors: DEBUG
    org.springframework.security: DEBUG
```

常见日志提示：
- `Reject: 'Origin' is not allowed` → 不在白名单。
- `Request header 'authorization' is not allowed` → 未放开该请求头。
- `Preflight request not allowed` → 方法/头/路径未放开或被其他过滤器先拦截。

---

## 九、案例：`Invalid CORS request` 403 定位与修复

现象：
```
HTTP/1.1 403
Set-Cookie: JSESSIONID=...; SameSite=Lax
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
...
Invalid CORS request
```

原因与修复：
1. `originPatterns` 误写为 `http://localhost:*`，**端口通配无效**，未命中 `http://localhost:5173`。  
   - 改为显式端口：`"http://localhost:5173","https://*.example.com"`。
2. 若启用了 Security：未 `http.cors(...)` 或未放行 `OPTIONS /**`。  
   - 在 `SecurityFilterChain` 加 `cors(Customizer.withDefaults())` 与 `permitAll()` 对 `OPTIONS`。

验证：使用“六、如何验证是否生效”中的 `curl` 与浏览器步骤。返回头应包含 `Access-Control-Allow-*` 且状态为 `200/204`。

---

## 十、附录：最小可用清单

**1）application.yml**（可全部省略走默认值）
```yaml
app:
  cors:
    enabled: true
    path-patterns: ["/**"]
    origin-patterns: ["http://localhost:5173","https://*.example.com"]
    allowed-methods: ["GET","POST","PUT","DELETE","OPTIONS"]
    allowed-headers: ["*"]
    exposed-headers: ["Content-Disposition"]
    allow-credentials: true
    max-age: 3600
```

**2）属性类 + MVC 全局**（`CorsProperties` + `CorsConfig`）  
见第四节代码；确保配置类位于组件扫描路径内。

**3）Security（Boot 3 / Security 6）**
```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
  @Bean
  SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
      .cors(Customizer.withDefaults())
      .csrf(csrf -> csrf.disable())
      .authorizeHttpRequests(auth -> auth
        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
        .anyRequest().permitAll()
      );
    return http.build();
  }
}
```

**4）复测命令（替换为真实地址）**
```bash
# 预检
curl -i -X OPTIONS "https://api.example.com/api/ping" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization"

# 实际
curl -i "https://api.example.com/api/ping" \
  -H "Origin: http://localhost:5173"
```
