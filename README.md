# removebg · 图片背景消除

100% 全自动、免费、**纯浏览器本地运行**的图片背景消除工具。图片永远不离开你的设备——抠图模型下载后完全在本机推理，可离线使用。

![removebg 截图](docs/screenshot.png)

**在线体验**：<https://removebg.sooo.ooo>

## ✨ 特性

- 🔒 **隐私优先** — 基于 [`@imgly/background-removal`](https://github.com/imgly/background-removal-js)（ISNet 模型），全部推理在浏览器内完成，图片从不上传服务器
- 🎯 **高精度模型** — 默认使用 `isnet_fp16`，发丝、半透明边缘等细节更出色
- ⚡ **多线程加速** — 通过 COOP/COEP 跨源隔离启用 SharedArrayBuffer，WASM 多线程推理约 5 秒出结果
- 📶 **离线可用（PWA）** — 可安装到桌面/主屏幕，模型与静态资源由 Service Worker 缓存，第二次起秒开
- 🖼️ **多图队列** — 一次处理多张图片，缩略图胶片条实时切换
- 🛠️ **内置编辑器** — 背景替换（透明/纯色/渐变/图片）、效果、调整、设计画布，支持撤销/重做
- 📥 **多格式导出** — PNG（透明）/ JPG / WebP，可调画质
- 📱 **移动端适配** — 触控友好的工具栏与处理进度提示

## 🚀 本地运行

无任何构建步骤，一个静态服务器即可（需要 Node.js）：

```bash
node tools/serve.mjs 4173
# 打开 http://localhost:4173
```

> 本地服务自带 COOP/COEP 响应头与视频 Range 支持，与生产环境行为一致。

## ☁️ 部署（Cloudflare Pages）

发布目录为 `public/`（根目录源码的干净副本）：

```bash
wrangler pages deploy public/ --project-name removebg
```

`public/_headers` 会为所有响应附加跨源隔离头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

这是 WASM 多线程推理的前提；旧浏览器会自动回退单线程，不影响功能。

## 🗂️ 项目结构

```
├── index.html            # 单页应用（首页 + 编辑器两个视图）
├── assets/
│   ├── css/styles.css    # 全部样式
│   ├── js/
│   │   ├── app.js        # 入口：视图切换、上传、抠图队列调度
│   │   ├── editor.js     # 画布编辑器（渲染、撤销重做、面板）
│   │   ├── remover.js    # 抠图引擎封装（加载超时 + 停滞看门狗）
│   │   ├── home.js       # 首页交互（拖拽遮罩、logo 眼睛动效）
│   │   └── ui.js         # toast / 进度等通用 UI
│   └── media/demo.gif    # 首页演示动图
├── sw.js                 # Service Worker（版本化预缓存 + CDN 陈旧优先）
├── manifest.webmanifest  # PWA 清单
├── public/               # 部署目录（含 _headers）
└── tools/serve.mjs       # 本地预览服务器
```

## 💡 实现要点

- **模型缓存**：模型权重（约 80MB）首次使用时下载，之后由浏览器 Cache Storage 持久化；下载过程有实时百分比提示
- **稳定性**：引擎加载每源 25s 超时自动切换 CDN 镜像（jsdelivr → esm.sh），抠图过程有停滞看门狗，网络挂死不会卡在"处理中"
- **Service Worker**：应用外壳缓存优先、导航网络优先，跨域 CDN 资源陈旧优先并在后台更新

## 📄 许可证

[MIT](LICENSE) © 2026 removebg contributors
