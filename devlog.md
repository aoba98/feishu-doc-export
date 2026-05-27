# Devlog

按版本倒序记录每次迭代的代码变更。版本号对应 `manifest.json` 中的 `version`，每次代码改动须同步 bump。

## 0.1.2 — 2026-05-27

### Added
- Popup 顶部新增醒目红色警告条：「导出期间请勿切换标签或最小化此窗口，否则插件 popup 会关闭，导致导出中断。」导出进行中时该条带有脉冲动画提醒。
- 新增导出选项「直接保存到浏览器默认下载文件夹（不弹出"另存为"对话框）」，默认关闭，保持历史行为不变。

### Changed
- `service_worker.js`：`chrome.downloads.download` 的 `saveAs` 不再硬编码为 `true`，改为读取 popup 传入的 `message.saveAs`（缺省仍为 `true`，向后兼容）。
- `popup.js`：导出开始时调用 `setWarningActive(true)` 触发警告条脉冲，结束时复位。

### Notes
- 这一版**未**改变滚动 / 解析逻辑，与 0.1.1 行为完全一致。
- 后台标签节流 + popup 失焦关闭仍然存在，本版本仅是更明确地告知用户限制；要做到真正后台导出，需要拆出独立 extension 页（规划中的 0.2.0）。

## 0.1.1 — 2026-05-27

### Fixed
- 修复底部 back-reference / 页脚面板中的图片被漏导出的问题（对比第三方导出工具少 1 张图）。
  - 新增 `findOrphanImageBlocks(rootNode, knownSources)`：在主解析流程结束后，扫描整页可见图片，把 src 不在已收集集合中的图片作为独立 image block 补回。
  - 仍保留对 `back_ref_list` 文本块的过滤，避免重复的引用条目污染正文；只补救图片。

### Changed
- 滚动循环更耐心，给底部懒加载更多时间：
  - `stablePasses` 3 → 4
  - `imageSettleTimeout` 1400ms → 2000ms
  - 新增 `bottomSettleDelay: 700ms`
- 主循环退出后增加 final settle：再次滚到 `scrollHeight - clientHeight`，等待 → 采集 → 再等待 → 再采集，给飞书底部懒渲染两次机会。

### Added
- 新单测 `dom parser rescues orphan images skipped by ignored block ancestors`，覆盖发现与按 src 去重两种路径。
- 仓库根目录新增 `CLAUDE.md`（架构、约束、命令说明），以及本 `devlog.md`。

## 0.1.0 — 2026-05-26

### Added
- 初版 Feishu Doc Export Chrome MV3 插件，按 `initial_goal.md` 规范实现：
  - Popup UI 检测页面、提供导出选项与进度展示
  - content.js 滚动 + 边滚边采集，处理虚拟列表
  - utils/domParser.js DOM → 结构化 blocks（含飞书 `data-block-type` 优先识别）
  - exporters/markdown.js blocks → Markdown
  - utils/image.js 图片下载与扩展名推断
  - utils/zip.js JSZip 打包
  - utils/filename.js 文件名清理
  - service_worker.js 仅承担 `chrome.downloads`
- Node 纯逻辑测试套件 `tests/run-tests.js`（33 项），覆盖文件名、Markdown 渲染、图片处理、DOM 解析。
