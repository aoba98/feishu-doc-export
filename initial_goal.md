请开发一个 Chrome Manifest V3 插件：Feishu Doc Export。

目标：
在飞书 / Lark 文档页面中，一键导出当前文档为 Markdown ZIP 包。导出前插件需要自动滚动页面到最底部，尽量触发飞书文档虚拟滚动加载全部内容。最终导出的 ZIP 包中必须包含：
1. document.md
2. assets/ 图片资源目录

技术要求：
- 使用 Chrome Extension Manifest V3
- 使用原生 JavaScript
- 不使用后端
- 不上传用户数据
- 所有解析、图片下载、Markdown 生成、ZIP 打包都在浏览器本地完成
- 支持 feishu.cn 和 larksuite.com
- 权限尽量最小化
- 需要 permissions：
  - activeTab
  - scripting
  - downloads
- 需要 host_permissions：
  - https://*.feishu.cn/*
  - https://*.larksuite.com/*
- 使用 JSZip 生成 ZIP 文件
- 可以将 JSZip 放在 lib/jszip.min.js，不要从 CDN 动态加载
- 不允许远程执行代码

核心功能：

1. Popup UI
- 显示插件名称：Feishu Doc Export
- 显示当前页面标题
- 检测当前页面是否为飞书 / Lark 文档
- 提供主要按钮：
  - Export Markdown ZIP
- 提供选项：
  - 导出前自动滚动到底部，默认开启
  - 导出图片资源，默认开启
  - 图片下载失败时保留原始 URL，默认开启
- 显示导出状态：
  - 正在检查页面
  - 正在滚动加载文档
  - 正在解析文档
  - 正在下载图片
  - 正在生成 Markdown
  - 正在打包 ZIP
  - 导出完成
  - 导出失败及错误原因

2. 自动滚动加载全文
- 在 content script 中实现 scrollToBottomAndCollect(options)
- 点击导出后，先自动滚动当前飞书文档页面到底部
- 需要考虑飞书文档可能不是 window 滚动，而是内部滚动容器
- 自动识别滚动容器：
  - 优先寻找页面中 scrollHeight > clientHeight 的主要容器
  - 如果找不到，则使用 document.scrollingElement
- 滚动逻辑要求：
  - 每次向下滚动一段距离，例如 800px 或一个视口高度的 80%
  - 每次滚动后等待 300-800ms，让飞书文档懒加载内容
  - 检测 scrollTop 是否接近 scrollHeight - clientHeight
  - 连续多次没有新增 DOM 内容、scrollHeight 不再变化、并且已接近底部时停止
  - 设置最大滚动次数，例如 200 次，避免死循环
  - 滚动过程中通过 chrome.runtime.sendMessage 或返回状态更新 popup 进度
- 滚动过程中尽量收集已经出现过的文档块，避免虚拟滚动导致上方 DOM 被卸载后丢失
- 需要实现一个 block 去重机制：
  - 根据文本内容、图片 src、元素 tag、位置等生成 block key
  - 已收集过的 block 不重复加入
- 注意：飞书可能使用虚拟列表，滚到底后顶部内容可能被卸载，所以必须边滚动边收集，而不是滚完再解析一次

3. 文档内容提取
- 从当前页面 DOM 中提取文档内容
- 需要尽量支持：
  - 标题 h1/h2/h3/h4/h5/h6
  - 段落
  - 加粗
  - 斜体
  - 删除线
  - 行内代码
  - 链接
  - 图片
  - 无序列表
  - 有序列表
  - 表格
  - 代码块
  - 引用
- 输出结构化中间格式：
  {
    title: string,
    blocks: [
      { type: "heading", level: 1, children: [...] },
      { type: "paragraph", children: [...] },
      { type: "image", src: "...", alt: "...", filename: "..." },
      { type: "table", rows: [...] },
      { type: "code", language: "...", text: "..." },
      { type: "quote", children: [...] },
      { type: "list", ordered: false, items: [...] }
    ],
    images: [
      { src: "...", filename: "assets/image_001.png" }
    ]
  }
- DOM 解析逻辑需要尽量鲁棒，不能强依赖单一飞书 class name
- 可以结合语义标签、role、contenteditable、文本密度、图片元素等方式提取

4. Markdown 导出
- ZIP 中生成 document.md
- Markdown 需要引用本地 assets 图片路径
- 图片格式示例：
  ![alt](assets/image_001.png)
- 标题转换：
  # / ## / ###
- 段落转换为普通文本
- 加粗转换为 **text**
- 斜体转换为 *text*
- 删除线转换为 ~~text~~
- 行内代码转换为 `code`
- 链接转换为 [text](url)
- 代码块转换为 fenced code block
- 引用转换为 > text
- 无序列表转换为 - item
- 有序列表转换为 1. item
- 表格转换为 Markdown table
- 需要处理特殊字符转义，避免 Markdown 格式错乱

5. 图片下载与 assets
- 解析文档中的所有图片
- 为图片生成稳定文件名：
  - assets/image_001.png
  - assets/image_002.jpg
  - assets/image_003.webp
- 根据 Content-Type 或 URL 后缀判断扩展名
- 支持图片来源：
  - https URL
  - data:image/*
  - blob URL
- 使用 fetch 下载图片为 Blob
- 如果 fetch 失败：
  - Markdown 中保留原始图片 URL
  - 在导出日志中记录失败图片
- 成功下载的图片写入 ZIP 的 assets/ 目录
- document.md 中使用本地 assets 路径引用成功下载的图片
- 避免重复下载相同 src，使用 src 去重
- 注意跨域图片可能失败，需要 graceful fallback

6. ZIP 打包
- 使用 JSZip
- ZIP 结构必须类似：
  feishu-doc-export-title.zip
  ├── document.md
  └── assets/
      ├── image_001.png
      ├── image_002.jpg
      └── image_003.webp
- 如果没有图片，也需要正常导出 document.md
- 使用 chrome.downloads API 下载 ZIP
- 文件名基于文档标题生成，清理非法字符：
  / \ : * ? " < > |
- 如果标题为空，使用 feishu-document-export.zip

7. 项目结构
请生成完整项目，目录结构如下：

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
└── README.md

8. 代码实现要求
- popup.js 负责 UI 事件、状态展示、调用 content script
- content.js 负责滚动加载和 DOM 采集
- utils/domParser.js 负责 DOM 转结构化 blocks
- exporters/markdown.js 负责 blocks 转 Markdown
- utils/image.js 负责图片下载、Blob/base64 处理、扩展名判断
- utils/zip.js 负责 JSZip 打包
- utils/filename.js 负责文件名清理
- service_worker.js 负责 chrome.downloads 下载
- 每个模块职责清晰，不要全部写在一个文件里
- 代码注释使用英文
- UI 和 README 使用中文
- 所有关键步骤需要 try/catch
- popup 中要显示错误信息，不能静默失败

9. 已知限制需要写进 README
- 飞书文档 DOM 结构可能变化，插件无法保证永久兼容
- 飞书使用虚拟滚动时，插件会边滚动边收集内容，但仍可能无法 100% 还原复杂文档
- 部分图片可能因为跨域、权限或 blob 生命周期问题无法下载
- 多维表格、表格、思维导图、嵌入内容可能只能部分导出
- 插件只在本地浏览器处理数据，不上传服务器

10. 本地安装说明
README 中写明：
1. 打开 chrome://extensions/
2. 开启 Developer Mode
3. 点击 Load unpacked
4. 选择 feishu-doc-export 项目目录
5. 打开飞书文档页面
6. 点击插件图标
7. 点击 Export Markdown ZIP

11. 测试场景
请在 README 中给出测试清单：
- 普通文字文档
- 多级标题
- 图片文档
- 含表格文档
- 含代码块文档
- 长文档，需要自动滚动加载
- 图片下载失败的情况
- 非飞书页面

请直接生成完整可运行代码。优先保证 Markdown ZIP 导出功能可用，HTML 和 DOCX 暂时不做。