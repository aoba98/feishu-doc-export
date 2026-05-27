# Feishu Doc Export

Feishu Doc Export 是一个 Chrome Manifest V3 插件，用于在飞书 / Lark 文档页面中一键导出当前文档为 Markdown ZIP 包。

导出的 ZIP 包包含：

- `document.md`
- `assets/` 图片资源目录

插件只在浏览器本地处理数据，不使用后端，不上传用户数据，不从 CDN 动态加载代码。`JSZip` 已作为本地文件放在 `lib/jszip.min.js`。

## 功能

- 检测当前页面是否属于 `feishu.cn` 或 `larksuite.com`
- 导出前自动滚动到底部，尽量触发虚拟滚动和懒加载
- 滚动过程中边滚动边收集内容块，减少虚拟列表卸载造成的内容丢失
- 支持标题、段落、加粗、斜体、删除线、行内代码、链接、图片、列表、表格、代码块和引用的 Markdown 转换
- 下载图片到 `assets/`，并在 Markdown 中引用本地路径
- 图片下载失败时可保留原始 URL
- 使用 `chrome.downloads` 下载 ZIP 文件

## 项目结构

```text
feishu-doc-export/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── content.js
├── service_worker.js
├── lib/
│   └── jszip.min.js
├── exporters/
│   └── markdown.js
├── utils/
│   ├── domParser.js
│   ├── image.js
│   ├── zip.js
│   └── filename.js
├── tests/
│   └── run-tests.js
└── README.md
```

## 本地安装

1. 打开 `chrome://extensions/`
2. 开启 Developer Mode
3. 点击 Load unpacked
4. 选择 `feishu-doc-export` 项目目录
5. 打开飞书 / Lark 文档页面
6. 点击插件图标
7. 点击 `Export Markdown ZIP`

## 权限说明

插件使用的权限：

- `activeTab`：访问当前激活的飞书 / Lark 文档页面
- `scripting`：向当前页面注入本地 content script
- `downloads`：下载生成的 ZIP 文件

插件使用的站点权限：

- `https://*.feishu.cn/*`
- `https://*.larksuite.com/*`
- `https://*.feishucdn.com/*`
- `https://*.larksuitecdn.com/*`

其中 `feishucdn.com` 和 `larksuitecdn.com` 用于下载文档正文中的图片资源。没有这些图片 CDN 权限时，Chrome 扩展页面里的 `fetch` 可能会返回 `Failed to fetch`，插件会按选项在 Markdown 中保留原始图片 URL。

## 已知限制

- 飞书文档 DOM 结构可能变化，插件无法保证永久兼容
- 飞书使用虚拟滚动时，插件会边滚动边收集内容，但仍可能无法 100% 还原复杂文档
- 部分图片可能因为跨域、权限或 blob 生命周期问题无法下载
- 多维表格、复杂表格、思维导图、嵌入内容可能只能部分导出
- 插件只在本地浏览器处理数据，不上传服务器

## 测试清单

- 普通文字文档
- 多级标题
- 图片文档
- 含表格文档
- 含代码块文档
- 长文档，需要自动滚动加载
- 图片下载失败的情况
- 非飞书页面

## 开发验证

项目包含少量 Node.js 纯逻辑测试，用于验证文件名清理、Markdown 渲染和图片命名：

```bash
node tests/run-tests.js
```
