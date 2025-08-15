// quartz.config.ts（站点仓根）
import type { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

const config: QuartzConfig = {
  configuration: {
    // —— 站点元信息 ——
    pageTitle: "我的笔记",
    pageTitleSuffix: "",
    locale: "zh-CN",
    enableSPA: true,
    enablePopovers: true,

    // —— GitHub Pages 路径 —— 无自定义域名时必须写成 “用户名.github.io/站点仓库名”，不带 http(s)
    // 例如：zxcgz.github.io/learn-doc   （请改成你的站点仓名字）
    baseUrl: "zxcgz.github.io/learn-doc",

    // —— 主题（颜色/字体）—— 这些键名要完整 —— 
    theme: {
      cdnCaching: true,
      typography: {
        header: "Inter",
        body: "Inter",
        code: "JetBrains Mono",
        title: "Inter",
      },
      colors: {
        light: "#ffffff",
        lightgray: "#e5e7eb",
        gray: "#9ca3af",
        darkgray: "#374151",
        dark: "#111827",
        secondary: "#4f46e5",
        tertiary: "#7c3aed",
        highlight: "#fff7cc",
        textHighlight: "#fff2ab",
      },
    },

    // —— 构建时忽略 ——（这里是站点仓自己的忽略，不影响内容仓）
    ignorePatterns: [
      "**/_quartz/**",
      "**/.quartz/**",
      "**/site/**",
      "**/node_modules/**",
      "**/.github/**",
      "**/.obsidian/**",
    ],

    // // （可选）统计
    // analytics: { provider: "google", tagId: "G-XXXXXXX" },
  },

  plugins: {
    // —— 内容变换（按需增减） ——
    transformers: [
      Plugin.FrontMatter(),
      Plugin.ObsidianFlavoredMarkdown(),   // 支持 Obsidian 语法
      Plugin.Description(),
      Plugin.TableOfContents(),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.SyntaxHighlighting(),         // 代码高亮（保持默认主题最稳）
      Plugin.Latex({ renderEngine: "katex" }),
    ],

    // —— 过滤（默认移除 draft） ——
    filters: [Plugin.RemoveDrafts()],
    // filters: [Plugin.ExplicitPublish()],  // 若想“仅显式发布”的策略可改为这一行

    // —— 输出发射器（决定生成哪些页面/资源） ——
    emitters: [
      Plugin.Assets(),              // 复制 content 里的附件到 public
      Plugin.Static(),              // 复制 quartz/static/** 到 public/static/**
      Plugin.ContentIndex(),        // 搜索索引（Search 组件需要）
      Plugin.ContentPage(),         // 单篇内容页
      Plugin.TagPage(),             // 标签列表页
      Plugin.FolderPage(),          // 目录列表页
      Plugin.NotFoundPage(),        // 404
      Plugin.ComponentResources(),  // 样式与脚本（依赖 theme.colors）
      Plugin.Favicon(),             // 用 quartz/static/icon.png 生成 favicon

      // （可选）如果你用自定义域名，可以同时放一个 CNAME 文本文件在 quartz/static/CNAME
      // 或使用插件：Plugin.CNAME({ domain: "notes.example.com" }),
    ],
  },
}

export default config
