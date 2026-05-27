(function (root) {
  "use strict";

  const CONTENT_VERSION = "2026-05-27.6";
  const START_MESSAGE_TYPE = "FEISHU_EXPORT_START_V6";
  const FETCH_IMAGE_MESSAGE_TYPE = "FEISHU_EXPORT_FETCH_IMAGE_V6";

  if (root.__FEISHU_DOC_EXPORT_CONTENT_VERSION__ === CONTENT_VERSION) {
    return;
  }
  root.__FEISHU_DOC_EXPORT_CONTENT_READY__ = true;
  root.__FEISHU_DOC_EXPORT_CONTENT_VERSION__ = CONTENT_VERSION;

  const parser = root.FeishuDocExport && root.FeishuDocExport.domParser;
  const collectedBlocks = new Map();
  const blobImageDataUrls = new Map();

  function delay(ms) {
    return new Promise((resolve) => root.setTimeout(resolve, ms));
  }

  function sendStatus(status, detail) {
    try {
      chrome.runtime.sendMessage({
        type: "FEISHU_EXPORT_STATUS",
        status,
        detail: detail || "",
      });
    } catch (error) {
      // Popup may be closed; export should keep running until the caller receives a response.
    }
  }

  function isDocumentScroller(element) {
    return (
      !element ||
      element === document.body ||
      element === document.documentElement ||
      element === document.scrollingElement
    );
  }

  function getMetrics(container) {
    if (isDocumentScroller(container)) {
      const scroller = document.scrollingElement || document.documentElement;
      return {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: root.innerHeight || scroller.clientHeight,
      };
    }
    return {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
  }

  function setScrollTop(container, top) {
    if (isDocumentScroller(container)) {
      root.scrollTo({ top, behavior: "auto" });
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = top;
      }
      return;
    }
    container.scrollTop = top;
  }

  function findScrollContainer() {
    const fallback = document.scrollingElement || document.documentElement;
    const elements = Array.from(document.querySelectorAll("body *"));
    let best = null;
    let bestScore = 0;

    elements.forEach((element) => {
      const overflow = root.getComputedStyle(element).overflowY;
      const canScroll = element.scrollHeight > element.clientHeight + 100;
      if (!canScroll) {
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 240 || rect.height < 240) {
        return;
      }
      const area = rect.width * rect.height;
      const overflowBonus = /auto|scroll|overlay/i.test(overflow) ? 100000 : 0;
      const docBonus = /doc|editor|reader|scroll/i.test(element.className || "") ? 50000 : 0;
      const score = area + element.scrollHeight + overflowBonus + docBonus;
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    });

    if (fallback && fallback.scrollHeight > fallback.clientHeight + 100) {
      const fallbackScore = fallback.scrollHeight + root.innerWidth * root.innerHeight;
      if (!best || fallbackScore > bestScore * 0.7) {
        return fallback;
      }
    }
    return best || fallback;
  }

  function isBlobImageSrc(src) {
    return /^blob:/i.test(String(src || ""));
  }

  function calculateScrollStep(metrics, options) {
    const opts = options || {};
    const clientHeight = Math.max(0, Number(metrics && metrics.clientHeight) || 0);
    const minStep = Math.max(1, Number(opts.minScrollStep) || 260);
    const maxStep = Math.max(minStep, Number(opts.maxScrollStep) || 480);
    const ratio = Math.max(0.1, Number(opts.scrollStepRatio) || 0.5);
    return Math.min(maxStep, Math.max(minStep, Math.floor(clientHeight * ratio)));
  }

  function getViewportBounds(container) {
    if (isDocumentScroller(container)) {
      return {
        top: 0,
        bottom: root.innerHeight || document.documentElement.clientHeight || 0,
      };
    }
    const rect = container.getBoundingClientRect();
    return {
      top: Math.max(0, rect.top),
      bottom: Math.min(root.innerHeight || document.documentElement.clientHeight || rect.bottom, rect.bottom),
    };
  }

  function elementOverlapsViewport(element, container, margin) {
    if (!element || typeof element.getBoundingClientRect !== "function") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 32 || rect.height < 32) {
      return false;
    }
    const bounds = getViewportBounds(container);
    const buffer = Math.max(0, Number(margin) || 0);
    return rect.bottom >= bounds.top - buffer && rect.top <= bounds.bottom + buffer;
  }

  function closestImageBlock(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    return (
      element.closest(
        [
          "[data-block-type='image']",
          "[data-docx-block-type='image']",
          ".docx-image-block",
          "[data-record-id]",
          "[data-block-id]",
          "[data-doc-block-id]",
        ].join(",")
      ) || element
    );
  }

  function getVisibleImageBlocks(container) {
    const rootNode = isDocumentScroller(container) ? document.body : container;
    const selector = [
      "[data-block-type='image']",
      "[data-docx-block-type='image']",
      ".docx-image-block",
      "[image-token]",
      "img.docx-image",
      "img[class*='docx-image']",
    ].join(",");
    const seen = new Set();
    const blocks = [];
    if (!rootNode || !rootNode.querySelectorAll) {
      return blocks;
    }
    rootNode.querySelectorAll(selector).forEach((element) => {
      const block = closestImageBlock(element);
      if (!block || seen.has(block) || !elementOverlapsViewport(block, container, 180)) {
        return;
      }
      seen.add(block);
      blocks.push(block);
    });
    return blocks;
  }

  function imageBlockHasLoadedSource(block) {
    if (!block) {
      return false;
    }
    const img =
      block.matches && block.matches("img")
        ? block
        : block.querySelector && block.querySelector("img.docx-image, img[class*='docx-image'], img");
    const sources = parser && parser.collectElementImageSources ? parser.collectElementImageSources(block) : [];
    if (!sources.length) {
      return false;
    }
    if (!img) {
      return true;
    }
    const src = img.currentSrc || img.src || "";
    if (!src) {
      return false;
    }
    if (img.complete === false) {
      return false;
    }
    return Boolean(img.naturalWidth || img.naturalHeight || sources.length);
  }

  function getPendingVisibleImageBlocks(container) {
    return getVisibleImageBlocks(container).filter((block) => !imageBlockHasLoadedSource(block));
  }

  async function waitForVisibleImagesToSettle(container, options) {
    const opts = options || {};
    const timeout = Math.max(0, Number(opts.imageSettleTimeout) || 1400);
    const interval = Math.max(50, Number(opts.imageSettleInterval) || 150);
    const startedAt = Date.now();
    let hadPending = false;

    while (Date.now() - startedAt < timeout) {
      const pending = getPendingVisibleImageBlocks(container);
      if (!pending.length) {
        return hadPending;
      }
      hadPending = true;
      await delay(interval);
    }
    return hadPending;
  }

  async function cacheBlobImagesFromBlocks(blocks) {
    const images = parser.collectImages(blocks).filter((image) => isBlobImageSrc(image.src));
    for (const image of images) {
      if (blobImageDataUrls.has(image.src)) {
        continue;
      }
      try {
        await fetchImageAsDataUrl(image.src);
      } catch (error) {
        // Keep the original blob URL in the document; the download step will report failures.
      }
    }
  }

  async function collectVisibleBlocks(container) {
    if (!parser) {
      throw new Error("DOM parser is not loaded");
    }
    const rootNode = isDocumentScroller(container) ? document.body : container;
    const blocks = parser.extractBlocksFromRoot(rootNode);
    await cacheBlobImagesFromBlocks(blocks);
    let added = 0;
    blocks.forEach((block) => {
      const key = block.key || parser.createBlockKey(block);
      if (!key || collectedBlocks.has(key)) {
        return;
      }
      collectedBlocks.set(key, block);
      added += 1;
    });
    return { added, total: collectedBlocks.size };
  }

  async function collectSettledViewport(container, options) {
    const waitedForImages = await waitForVisibleImagesToSettle(container, options);
    let collection = await collectVisibleBlocks(container);
    if (waitedForImages) {
      await delay(80);
      collection = await collectVisibleBlocks(container);
    }
    return collection;
  }

  async function resetScrollToTop(container, options) {
    const metrics = getMetrics(container);
    if (metrics.scrollTop <= 4) {
      return;
    }
    sendStatus("scrolling", "正在回到文档顶部");
    setScrollTop(container, 0);
    await delay(options.waitMax);
  }

  async function scrollToBottomAndCollect(options) {
    const opts = Object.assign(
      {
        maxScrolls: 400,
        waitMin: 300,
        waitMax: 800,
        stablePasses: 4,
        minScrollStep: 260,
        maxScrollStep: 480,
        scrollStepRatio: 0.5,
        imageSettleTimeout: 2000,
        imageSettleInterval: 150,
        bottomSettleDelay: 700,
      },
      options || {}
    );
    const container = findScrollContainer();
    await resetScrollToTop(container, opts);

    let lastHeight = -1;
    let lastTop = -1;
    let lastTotal = -1;
    let stableCount = 0;

    for (let index = 0; index < opts.maxScrolls; index += 1) {
      const collection = await collectSettledViewport(container, opts);
      const metrics = getMetrics(container);
      const nearBottom =
        metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - Math.max(32, metrics.clientHeight * 0.03);
      const unchanged =
        collection.total === lastTotal &&
        Math.abs(metrics.scrollHeight - lastHeight) < 4 &&
        Math.abs(metrics.scrollTop - lastTop) < 4;

      sendStatus("scrolling", `第 ${index + 1} 次滚动，已收集 ${collection.total} 个内容块`);

      if (nearBottom && unchanged) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }
      if (nearBottom && stableCount >= opts.stablePasses) {
        break;
      }

      lastHeight = metrics.scrollHeight;
      lastTop = metrics.scrollTop;
      lastTotal = collection.total;

      const step = calculateScrollStep(metrics, opts);
      const nextTop = Math.min(metrics.scrollTop + step, Math.max(0, metrics.scrollHeight - metrics.clientHeight));
      setScrollTop(container, nextTop);
      await delay(opts.waitMin + Math.floor(Math.random() * Math.max(1, opts.waitMax - opts.waitMin)));
    }

    // Final settle: nudge once more to the bottom, wait extra long for late
    // image loads, then collect twice. Feishu's back-reference / footer panel
    // often renders only after the main content stabilises.
    const finalMetrics = getMetrics(container);
    setScrollTop(container, Math.max(0, finalMetrics.scrollHeight - finalMetrics.clientHeight));
    await delay(opts.bottomSettleDelay);
    await collectSettledViewport(container, opts);
    await delay(opts.bottomSettleDelay);
    await collectSettledViewport(container, opts);
    return {
      blockCount: collectedBlocks.size,
      metrics: getMetrics(container),
    };
  }

  async function exportDocument(options) {
    collectedBlocks.clear();
    blobImageDataUrls.clear();
    sendStatus("parsing", "准备解析当前页面");
    try {
      if (options && options.autoScroll) {
        sendStatus("scrolling", "正在滚动加载文档");
        await scrollToBottomAndCollect(options);
      } else {
        await collectVisibleBlocks(findScrollContainer());
      }

      sendStatus("parsing", "正在整理内容块");
      const blocks = Array.from(collectedBlocks.values());
      const images = parser.collectImages(blocks);
      const title = parser.extractTitle(blocks);

      return {
        ok: true,
        document: {
          title,
          blocks,
          images,
        },
        meta: {
          blockCount: blocks.length,
          imageCount: images.length,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : String(error),
      };
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Failed to read image blob"));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchImageAsDataUrl(src) {
    if (/^data:image\//i.test(src)) {
      return src;
    }
    if (isBlobImageSrc(src) && blobImageDataUrls.has(src)) {
      return blobImageDataUrls.get(src);
    }
    const response = await fetch(src, {
      credentials: "include",
      cache: "force-cache",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const dataUrl = await blobToDataUrl(await response.blob());
    if (isBlobImageSrc(src)) {
      blobImageDataUrls.set(src, dataUrl);
    }
    return dataUrl;
  }

  const contentApi = {
    calculateScrollStep,
    imageBlockHasLoadedSource,
  };

  root.FeishuDocExport = root.FeishuDocExport || {};
  root.FeishuDocExport.content = contentApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = contentApi;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type === undefined) {
      return false;
    }
    if (message.type === START_MESSAGE_TYPE) {
      exportDocument(message.options || {}).then(sendResponse);
      return true;
    }
    if (message.type === FETCH_IMAGE_MESSAGE_TYPE) {
      fetchImageAsDataUrl(message.src)
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : String(error),
          })
        );
      return true;
    }
    return false;
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
