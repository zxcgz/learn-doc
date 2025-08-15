// quartz.config.ts (site repo, branch v4)
import type { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 Configuration
 * Docs: https://quartz.jzhao.xyz/configuration
 */
const config: QuartzConfig = {
  configuration: {
    // —— 站点元信息 ——
    pageTitle: "我的笔记",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,

    // 若你启用了 Plausible，这里建议补上域名（不需要协议）
    // analytics: { provider: "plausible", domain: "zxcgz.github.io" },
    // 没用就先关掉，避免不必要的外链加载
    // ↓ 如果你确实要用，请把上面一行打开，并删除下面这一行：
    analytics: undefined as any,

    // 本地化
    locale: "zh-CN",

    // GitHub Pages（无自定义域名）必须是“用户名.github.io/仓库名”
    baseUrl: "zxcgz.github.io/learn-doc",

    // 建议默认用“按修改时间”排序
    defaultDateType: "modified",

    // —— 索引/构建忽略 ——（用通配符更稳）
    ignorePatterns: [
      "**/.obsidian/**",
      "**/.github/**",
      "**/node_modules/**",
      "**/_quartz/**",
      "**/.quartz/**",
      "**/site/**",
      "**/private/**",
      "**/templates/**",
    ],

    // —— 主题（Quartz v4: colors 分为 lightMode / darkMode）——
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Schibsted Grotesk",
        body: "Source Sans Pro",
        code: "IBM Plex Mono",
        title: "Schibsted Grotesk",
      },
      colors: {
        lightMode: {
          light: "#faf8f8",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#284b63",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#fff23688",
        },
        darkMode: {
          light: "#161618",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7b97aa",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },

  plugins: {
    // —— 内容转换流程（顺序基本保持你原来的）——
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: { light: "github-light", dark: "github-dark" },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],

    // —— 过滤器（默认移除 draft）——
    filters: [Plugin.RemoveDrafts()],

    // —— 输出（发射器）——
    // 保留你的发射器组合；为兼容 Search 增加 ContentIndex（你已开启）
    emitters: [
      Plugin.Assets(),               // content 内的附件
      Plugin.Static(),               // quartz/static/** → /static/**
      Plugin.ComponentResources(),   // 样式/脚本（依赖 theme.colors）
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Favicon(),              // 需要 quartz/static/icon.png
      Plugin.NotFoundPage(),

      // ⚠️ 生成社交图会显著拉长构建时间，如非必要可注释掉
      // Plugin.CustomOgImages(),
    ],
  },
}

export default config
