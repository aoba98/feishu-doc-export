# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The repo root IS the Chrome Manifest V3 extension — no nested folder, no monorepo. The `initial_goal.md` here is the original Chinese product/technical spec; treat it as the source of truth for design intent (permissions, supported block types, no-remote-code rules, etc.).

There is no `package.json`, no bundler, and no build step. The extension is loaded unpacked from the repo root directly.

## Commands

```bash
# Run the test suite (Node, no deps, no build) — from repo root
node tests/run-tests.js
```

Load the extension locally:

1. `chrome://extensions/` → enable Developer Mode → Load unpacked → select this repo's root folder.
2. After editing any file, click the reload icon on the extension card. Content scripts are re-injected on each export (see "Content script re-injection" below), so popup/service-worker changes need the reload but content-script edits take effect on the next export click.

## Iteration discipline (REQUIRED for every code change)

The maintainer runs many short iterations on this extension and relies on three artifacts to track what's in the loaded build. Every code-change iteration must do all of the following before the task is "done":

1. **Bump `manifest.json` `version`** using semver — patch for bugfix, minor for feature, major for breaking change.
2. **Prepend a new entry to [devlog.md](devlog.md)** under the new version, newest on top. Use `## <version> — <YYYY-MM-DD>` with `### Fixed / Changed / Added` sub-bullets. Keep entries in Chinese to match README/UI conventions.
3. **Update this CLAUDE.md** if the change affects architecture, commands, conventions, or the mental model a future session needs. Pure local bugfixes (e.g. a one-line parser tweak that doesn't shift how anything is structured) do not require a CLAUDE.md edit.

Pure-documentation edits don't need a version bump, but should still get a devlog line if user-visible. When unsure, bump — extra patch versions are cheap.

## Architecture

### Module loading is dual-mode (browser IIFE + CommonJS)

Every module in `utils/`, `exporters/`, plus `content.js`, is wrapped in an IIFE that:

1. Attaches its API to `globalThis.FeishuDocExport.<name>` (so popup/content code can call e.g. `FeishuDocExport.markdown.renderMarkdown(...)`), and
2. Also exports via `module.exports` when `typeof module !== "undefined"`.

The Node test runner ([tests/run-tests.js](tests/run-tests.js)) relies on the CommonJS half. **Preserve this pattern in new modules** — tests `require()` the same source files the extension ships, so any new utility needs both surfaces or it can't be unit-tested.

`content.js` additionally guards against double-registration via `root.__FEISHU_DOC_EXPORT_CONTENT_VERSION__`. Test setup deletes that flag before requiring the file (see lines 18 and 9–24 of [tests/run-tests.js](tests/run-tests.js)).

### Export pipeline (popup-driven, not content-driven)

The popup is the orchestrator. The content script only does what must run in the page context (DOM walking, scrolling, fetching same-origin blob images). The split:

1. **[popup.js](popup.js)** detects a Feishu/Lark URL, then on click:
   - Injects `utils/domParser.js` + `content.js` into the tab via `chrome.scripting.executeScript`.
   - Sends `FEISHU_EXPORT_START_V6` to the tab; receives a structured `{title, blocks, images}` document back.
   - Downloads images itself (in the popup's extension context, which has the `feishucdn.com` / `larksuitecdn.com` host permissions). For `blob:` URLs it round-trips through the content script via `FEISHU_EXPORT_FETCH_IMAGE_V6` since blobs are page-scoped.
   - Renders Markdown via `FeishuDocExport.markdown.renderMarkdown`, zips via `FeishuDocExport.zip.createDocumentZip`.
   - Hands the ZIP blob URL to the service worker via `FEISHU_EXPORT_DOWNLOAD_ZIP`.

2. **[content.js](content.js)** owns the scroll-and-collect loop. Key invariants:
   - Feishu uses **virtualized scrolling**, so DOM above the viewport gets unmounted. The loop must collect blocks *during* each scroll step, not after. `collectedBlocks` is a `Map` keyed by `parser.createBlockKey(block)` for dedup.
   - The scroll container is not necessarily `window`. `findScrollContainer()` scores candidates by overflow style, area, and class-name hints.
   - Before each collection pass, `waitForVisibleImagesToSettle()` waits for in-viewport `img` elements to finish loading so the parser sees real `src` attributes (Feishu uses blob URLs that resolve lazily).
   - Blob image data URLs are cached in `blobImageDataUrls` so the popup's later `FETCH_IMAGE` round-trip can resolve them even after the blob revokes.

3. **[service_worker.js](service_worker.js)** is intentionally minimal — only `chrome.downloads.download` for the final ZIP. Don't move logic into it; MV3 service workers idle out and the popup context is the right place for heavyweight work.

### DOM parsing: rules of the road

[utils/domParser.js](utils/domParser.js) is the most fragile piece because Feishu/Lark ship DOM changes regularly. The defensive patterns it uses, in priority order:

1. **Feishu block-type attributes first** (`data-block-type`, `data-docx-block-type`). Helpers like `headingLevelFromBlockType`, `isFeishuImageBlockType`, `isFeishuListBlockType`, `isFeishuQuoteBlockType`, `isFeishuContainerBlockType` interpret these. Add to these enums when supporting new block types, don't sprinkle string comparisons.
2. **Semantic HTML fallback** (`H1..H6`, `UL/OL`, `TABLE`, `BLOCKQUOTE`, `PRE`).
3. **Heuristic last** (class-name regex via `[class*='xxx' i]` matchers in `isIgnoredElement`).

Image source resolution (`pickBestImageSource`) is layered — `currentSrc` → blob mapped to a recent `performance.getEntriesByType("resource")` entry matching `mount_point=docx_image` → `data-src`/`data-original`/etc → `srcset` → CSS background. UI noise (avatars, empty-state illustrations, tiny SVG icons) is filtered via `isLikelyUiImageSource` and `isTinySvgIconElement`. When adding image-source extraction, **also extend `tests/run-tests.js`** — the existing tests cover the contract for UI filtering, srcset selection, canvas snapshotting, and the blob↔resource mapping, and they're the only safety net.

### Messaging contract: versioned types

Message types are versioned (`..._V6`). The popup checks the content script version (`CONTENT_VERSION` in content.js) implicitly via the message-type constant. If you change the wire format between popup ↔ content, bump both `START_MESSAGE_TYPE` / `FETCH_IMAGE_MESSAGE_TYPE` *and* `CONTENT_VERSION` so a stale content script in a long-lived tab doesn't silently mishandle a new payload.

### Content script re-injection on every export

Every export call re-runs `executeScripts(tabId, ["utils/domParser.js", "content.js"])`. The version guard in content.js makes re-injection a no-op when the tab already has the current version. This means:

- You don't need a `chrome.tabs.reload()` after editing content/parser code — just re-open the popup and click Export.
- A content script of a different version is replaced by the version check returning early; the *new* file's listeners are *not* registered because the early-return happens before `addListener`. To force a content reload during development, reload the page.

## Constraints from the spec (do not violate)

These come from [initial_goal.md](initial_goal.md) and shape what's safe to change:

- **No remote code, no CDN loading.** `lib/jszip.min.js` is vendored on purpose. Don't replace it with a CDN `<script>` and don't pull npm deps that would require a bundler.
- **No backend, no telemetry, no upload.** All parsing, image fetching, and ZIP packing happen in the browser.
- **Minimal permissions.** The manifest grants `activeTab`, `scripting`, `downloads`, and four host patterns (`feishu.cn`, `larksuite.com`, `feishucdn.com`, `larksuitecdn.com`). Don't broaden these without a concrete reason — `feishucdn.com` / `larksuitecdn.com` exist solely so extension-context `fetch` can pull images.
- **Code comments in English; UI strings and README in Chinese.** The user-facing `popup.html`, `popup.js` status labels, and `README.md` are Chinese by design.
- **Graceful image fallback.** If an image fetch fails, the Markdown must still render — either with the original URL (when `preserveOriginalUrl` is on) or with the local asset name. The failure is logged in the popup, never swallowed silently.
