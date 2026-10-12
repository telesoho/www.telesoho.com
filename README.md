# www.telesoho.com

个人主页（静态站点）。访客模式介绍作品；`</>` 切换工程模式，用公式与两个轻量实验说明实现边界。

博客在独立仓库 [`telesoho.github.io`](https://github.com/telesoho/telesoho.github.io)，域名 `blog.telesoho.com`。

## 本地预览

用任意静态服务器打开仓库根目录，例如：

```bash
npx --yes serve .
```

工程模式：打开页面后点顶栏 `</>`，或访问 `#engineering`。

## GitHub Pages

1. 推送到 GitHub 用户 `telesoho` 的公开仓库
2. Settings → Pages：Source 选 `main`，目录 `/`
3. Custom domain：`www.telesoho.com`（仓库内已有 `CNAME`）
4. DNS：`www` CNAME → `telesoho.github.io`；顶点域名四条 A 记录指向 GitHub Pages IP；勿改动 `blog` 记录
5. 证书就绪后打开 Enforce HTTPS
