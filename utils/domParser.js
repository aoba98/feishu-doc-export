(function (root) {
  "use strict";

  const BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "UL",
  ]);

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "IFRAME",
    "SVG",
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
  ]);

  const IMAGE_ATTRIBUTE_NAMES = [
    "src",
    "data-src",
    "data-original",
    "data-original-src",
    "data-origin-src",
    "data-url",
    "data-image-url",
    "data-image-src",
    "data-preview-src",
    "data-lazy-src",
    "poster",
  ];

  const SRCSET_ATTRIBUTE_NAMES = ["srcset", "data-srcset"];

  function compactText(value) {
    return String(value || "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getAttribute(element, name) {
    if (!element) {
      return "";
    }
    if (typeof element.getAttribute === "function") {
      return element.getAttribute(name) || "";
    }
    return element[name] || "";
  }

  function cleanImageUrl(value) {
    const raw = String(value || "")
      .replace(/&amp;/g, "&")
      .trim();
    if (!raw || raw === "none" || raw === "about:blank") {
      return "";
    }
    const cssUrl = extractCssImageUrl(raw);
    const url = cssUrl || raw;
    if (/^(javascript|chrome-extension):/i.test(url)) {
      return "";
    }
    if (url.startsWith("//")) {
      return `https:${url}`;
    }
    return url;
  }

  function decodeUrlValue(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    try {
      return decodeURIComponent(raw);
    } catch (error) {
      return raw;
    }
  }

  function cleanLinkUrl(value) {
    const url = decodeUrlValue(value).replace(/&amp;/g, "&").trim();
    if (!url || /^(javascript|chrome-extension):/i.test(url)) {
      return "";
    }
    if (url.startsWith("//")) {
      return `https:${url}`;
    }
    return url;
  }

  function pickImageFromSrcset(srcset) {
    const candidates = String(srcset || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parts = entry.split(/\s+/);
        const url = cleanImageUrl(parts[0]);
        const descriptor = parts[1] || "";
        const scoreMatch = descriptor.match(/^([\d.]+)(w|x)$/i);
        const score = scoreMatch ? Number(scoreMatch[1]) * (scoreMatch[2].toLowerCase() === "x" ? 1000 : 1) : 1;
        return { url, score };
      })
      .filter((candidate) => candidate.url);

    candidates.sort((a, b) => b.score - a.score);
    return candidates.length ? candidates[0].url : "";
  }

  function extractCssImageUrl(styleValue) {
    const match = String(styleValue || "").match(/url\((['"]?)(.*?)\1\)/i);
    return match ? cleanImageUrl(match[2]) : "";
  }

  function isLikelyUiImageSource(src) {
    const value = String(src || "").toLowerCase();
    if (!value) {
      return false;
    }
    return (
      value.includes("cut_type=default-face") ||
      value.includes("default-face") ||
      value.includes("illustration_empty") ||
      value.includes("empty_positive_loading") ||
      /\/feishu-static\/.*\/module\/media\/illustration_/i.test(value) ||
      /(^|[/?#&=_-])avatar([/?#&=_-]|$)/i.test(value) ||
      /(^|[/?#&=_-])user[-_]?face([/?#&=_-]|$)/i.test(value) ||
      /(^|[/?#&=_-])profile[-_]?photo([/?#&=_-]|$)/i.test(value)
    );
  }

  function isTinySvgIconElement(element, src) {
    const value = String(src || "").toLowerCase();
    if (!value.includes(".svg") && !value.startsWith("data:image/svg")) {
      return false;
    }
    const rect =
      element && typeof element.getBoundingClientRect === "function"
        ? element.getBoundingClientRect()
        : { width: 0, height: 0 };
    const width = Number(element.naturalWidth || element.width || getAttribute(element, "width") || rect.width || 0);
    const height = Number(element.naturalHeight || element.height || getAttribute(element, "height") || rect.height || 0);
    return Boolean(width && height && width <= 32 && height <= 32);
  }

  function isFeishuDocumentImageResource(url) {
    const value = String(url || "");
    return (
      /\/space\/api\/box\/stream\/download\//i.test(value) &&
      /[?&]mount_point=docx_image(?:&|$)/i.test(value)
    );
  }

  function getFeishuDocumentImageResources() {
    if (!root.performance || typeof root.performance.getEntriesByType !== "function") {
      return [];
    }
    const seen = new Set();
    return root.performance
      .getEntriesByType("resource")
      .map((entry) => cleanImageUrl(entry && entry.name))
      .filter((url) => {
        if (!isFeishuDocumentImageResource(url) || seen.has(url)) {
          return false;
        }
        seen.add(url);
        return true;
      });
  }

  function getVisibleFeishuBlobImages() {
    if (!root.document || !root.document.querySelectorAll) {
      return [];
    }
    return Array.from(root.document.querySelectorAll("img.docx-image, img[class*='docx-image']"))
      .filter((image) => {
        const src = image.currentSrc || image.src || "";
        if (!src.startsWith("blob:")) {
          return false;
        }
        if (typeof image.getBoundingClientRect !== "function") {
          return true;
        }
        const rect = image.getBoundingClientRect();
        return rect.width >= 32 && rect.height >= 32;
      });
  }

  function pickFeishuDocumentImageResource(element, resources, visibleImages) {
    const src = element && (element.currentSrc || element.src || "");
    if (!src || !src.startsWith("blob:")) {
      return "";
    }
    const resourceList = (resources || []).filter(isFeishuDocumentImageResource);
    if (!resourceList.length) {
      return "";
    }
    const images = visibleImages || [];
    const index = Math.max(0, images.indexOf(element));
    const alignedResources =
      resourceList.length > images.length && images.length
        ? resourceList.slice(resourceList.length - images.length)
        : resourceList;
    return alignedResources[Math.min(index, alignedResources.length - 1)] || "";
  }

  function pickBestImageSource(element) {
    if (!element) {
      return "";
    }

    if (element.tagName === "CANVAS") {
      return getCanvasImageSource(element);
    }

    const currentSource = cleanImageUrl(element.currentSrc || element.src || "");
    if (/^blob:/i.test(currentSource)) {
      return currentSource;
    }

    const feishuResource = pickFeishuDocumentImageResource(
      element,
      getFeishuDocumentImageResources(),
      getVisibleFeishuBlobImages()
    );
    if (feishuResource) {
      return feishuResource;
    }

    const candidates = [];
    candidates.push(currentSource);

    SRCSET_ATTRIBUTE_NAMES.forEach((name) => {
      candidates.push(pickImageFromSrcset(getAttribute(element, name)));
    });

    IMAGE_ATTRIBUTE_NAMES.forEach((name) => {
      candidates.push(cleanImageUrl(getAttribute(element, name)));
    });

    const styleAttr = getAttribute(element, "style");
    candidates.push(extractCssImageUrl(styleAttr));

    if (root.getComputedStyle && element.nodeType === Node.ELEMENT_NODE) {
      try {
        candidates.push(extractCssImageUrl(root.getComputedStyle(element).backgroundImage));
      } catch (error) {
        // Some detached nodes do not support computed style.
      }
    }

    return candidates.find((src) => src && !isLikelyUiImageSource(src) && !isTinySvgIconElement(element, src)) || "";
  }

  function getCanvasImageSource(element) {
    if (!element || typeof element.toDataURL !== "function") {
      return "";
    }
    const width = Number(element.width || getAttribute(element, "width") || 0);
    const height = Number(element.height || getAttribute(element, "height") || 0);
    if (width < 32 || height < 32) {
      return "";
    }
    try {
      const dataUrl = element.toDataURL("image/png");
      return /^data:image\/png[;,]/i.test(dataUrl) ? dataUrl : "";
    } catch (error) {
      return "";
    }
  }

  function collectElementImageSources(element) {
    const sources = [];
    const seen = new Set();

    function addSource(src) {
      if (!src || seen.has(src) || isLikelyUiImageSource(src)) {
        return;
      }
      seen.add(src);
      sources.push(src);
    }

    function visit(node) {
      addSource(pickBestImageSource(node));
    }

    visit(element);
    if (element && element.querySelectorAll) {
      element
        .querySelectorAll(
          [
            "img",
            "canvas",
            "picture",
            "source",
            "[role='img']",
            "[data-src]",
            "[data-original]",
            "[data-original-src]",
            "[data-origin-src]",
            "[data-url]",
            "[data-image-url]",
            "[data-image-src]",
            "[data-preview-src]",
            "[data-lazy-src]",
            "[srcset]",
            "[data-srcset]",
            "[style*='background']",
          ].join(",")
        )
        .forEach(visit);
    }

    return sources;
  }

  function elementHasImageSource(element) {
    return collectElementImageSources(element).length > 0;
  }

  function getElementText(element) {
    return compactText(element && element.textContent);
  }

  function elementMatches(element, selector) {
    return Boolean(element && element.matches && element.matches(selector));
  }

  function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = root.getComputedStyle ? root.getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) {
      return false;
    }
    if (root.document && (element === root.document.body || element === root.document.documentElement)) {
      return true;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isIgnoredElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }
    if (SKIP_TAGS.has(element.tagName)) {
      return true;
    }
    if (isIgnoredFeishuBlockType(getFeishuBlockType(element))) {
      return true;
    }
    return elementMatches(
      element,
      [
        "[data-qa='toolbar']",
        "[data-testid*='toolbar' i]",
        "[class*='toolbar' i]",
        "[class*='catalogue' i]",
        "[class*='side' i]",
        "[class*='dropdown-menu' i]",
        "[class*='floating-menu' i]",
        "[class*='menu-container' i]",
        "[class*='comment' i]",
        "[class*='global-like' i]",
        "[class*='help-block' i]",
        "[class*='back_ref' i]",
        "[role='button']",
        "[role='navigation']",
        "[role='banner']",
        "[role='dialog']",
      ].join(",")
    );
  }

  function scoreContentRoot(element) {
    if (!element || !isElementVisible(element)) {
      return -1;
    }
    const textLength = getElementText(element).length;
    const images = element.querySelectorAll
      ? element.querySelectorAll(
          [
            "img",
            "picture",
            "source",
            "[role='img']",
            "[data-src]",
            "[data-original-src]",
            "[data-image-src]",
            "[srcset]",
            "[data-srcset]",
            "[style*='background']",
          ].join(",")
        ).length
      : 0;
    const headings = element.querySelectorAll
      ? element.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']").length
      : 0;
    const tables = element.querySelectorAll ? element.querySelectorAll("table,[role='table']").length : 0;
    const editorBonus = elementMatches(
      element,
      [
        "[contenteditable='true']",
        "[role='textbox']",
        "[data-page-id]",
        "[data-doc-block-id]",
        "[data-block-id]",
        "[class*='page-block-children' i]",
        "[class*='docx-page' i]",
        "[class*='docx-content' i]",
        "[class*='doc' i]",
        "[class*='editor' i]",
      ].join(",")
    )
      ? 600
      : 0;
    const bodyPenalty = element === document.body || element === document.documentElement ? 1200 : 0;
    return textLength + images * 180 + headings * 120 + tables * 240 + editorBonus - bodyPenalty;
  }

  function findContentRoot(rootNode) {
    const start = rootNode && rootNode.nodeType === Node.ELEMENT_NODE ? rootNode : document.body;
    const selectors = [
      "[contenteditable='true']",
      "[role='textbox']",
      "[data-page-id]",
      "[data-doc-block-id]",
      "[data-block-id]",
      "[class*='page-block-children' i]",
      "[class*='docx-page' i]",
      "[class*='docx-content' i]",
      "main",
      "article",
      "[class*='doc' i]",
      "[class*='editor' i]",
      "[class*='reader' i]",
    ].join(",");
    const candidates = [start];
    if (start.querySelectorAll) {
      start.querySelectorAll(selectors).forEach((element) => candidates.push(element));
    }
    let best = start;
    let bestScore = scoreContentRoot(start);
    candidates.forEach((candidate) => {
      const score = scoreContentRoot(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best || start;
  }

  function mergeInlineMark(child, marks) {
    const next = Object.assign({}, marks);
    const tag = child.tagName;
    if (tag === "B" || tag === "STRONG") {
      next.bold = true;
    }
    if (tag === "I" || tag === "EM") {
      next.italic = true;
    }
    if (tag === "S" || tag === "DEL" || tag === "STRIKE") {
      next.strike = true;
    }
    if (tag === "CODE" || tag === "KBD") {
      next.code = true;
    }
    const style = child.getAttribute("style") || "";
    if (/font-weight\s*:\s*(bold|[6-9]\d\d)/i.test(style)) {
      next.bold = true;
    }
    if (/font-style\s*:\s*italic/i.test(style)) {
      next.italic = true;
    }
    if (/text-decoration[^;]*line-through/i.test(style)) {
      next.strike = true;
    }
    const href = cleanLinkUrl(
      child.href ||
        getAttribute(child, "href") ||
        getAttribute(child, "data-href") ||
        getAttribute(child, "auto-url") ||
        getAttribute(child, "data-url")
    );
    if (href) {
      next.href = href;
    }
    return next;
  }

  function pushText(nodes, text, marks) {
    const compact = String(text || "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .replace(/\s+/g, " ");
    if (!compact.trim()) {
      if (nodes.length && !/\s$/.test(nodes[nodes.length - 1].text || "")) {
        nodes.push(Object.assign({ text: " " }, marks));
      }
      return;
    }
    nodes.push(Object.assign({ text: compact }, marks));
  }

  function parseInlineChildren(element, inheritedMarks) {
    const nodes = [];
    const marks = inheritedMarks || {};

    element.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        pushText(nodes, child.nodeValue, marks);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || isIgnoredElement(child)) {
        return;
      }
      if (child.tagName === "BR") {
        nodes.push({ text: "\n" });
        return;
      }
      const imageSources = collectElementImageSources(child);
      const imageLike =
        child.tagName === "IMG" ||
        child.tagName === "CANVAS" ||
        child.tagName === "PICTURE" ||
        child.tagName === "SOURCE" ||
        child.getAttribute("role") === "img" ||
        (!getElementText(child) && imageSources.length);
      if (imageLike && imageSources.length) {
        imageSources.forEach((src) => {
          nodes.push({ type: "image", src, alt: child.alt || child.getAttribute("aria-label") || "" });
        });
        return;
      }
      const childMarks = mergeInlineMark(child, marks);
      parseInlineChildren(child, childMarks).forEach((node) => nodes.push(node));
    });

    return mergeAdjacentText(nodes);
  }

  function mergeAdjacentText(nodes) {
    const merged = [];
    nodes.forEach((node) => {
      const last = merged[merged.length - 1];
      const sameMarks =
        last &&
        !last.type &&
        !node.type &&
        Boolean(last.bold) === Boolean(node.bold) &&
        Boolean(last.italic) === Boolean(node.italic) &&
        Boolean(last.strike) === Boolean(node.strike) &&
        Boolean(last.code) === Boolean(node.code) &&
        (last.href || "") === (node.href || "");
      if (sameMarks) {
        last.text += node.text;
      } else {
        merged.push(Object.assign({}, node));
      }
    });
    return merged.filter((node) => node.type === "image" || compactText(node.text));
  }

  function parseHeading(element) {
    const tagLevel = /^H([1-6])$/.exec(element.tagName);
    const roleLevel = element.getAttribute("aria-level");
    const blockTypeLevel = headingLevelFromBlockType(getFeishuBlockType(element));
    const level = tagLevel
      ? Number(tagLevel[1])
      : blockTypeLevel || Math.min(Math.max(Number(roleLevel) || 2, 1), 6);
    return { type: "heading", level, children: parseInlineChildren(element) };
  }

  function parseCode(element) {
    const code = element.tagName === "PRE" ? element.querySelector("code") : element;
    const className = (code && code.className) || element.className || "";
    const languageMatch = String(className).match(/language-([a-z0-9_+-]+)/i);
    return {
      type: "code",
      language: languageMatch ? languageMatch[1] : "",
      text: (code || element).innerText || (code || element).textContent || "",
    };
  }

  function parseTable(element) {
    const rows = [];
    element.querySelectorAll("tr").forEach((row) => {
      const cells = [];
      row.querySelectorAll("th,td").forEach((cell) => {
        cells.push(compactText(cell.innerText || cell.textContent));
      });
      if (cells.length) {
        rows.push(cells);
      }
    });
    return rows.length ? { type: "table", rows } : null;
  }

  function parseList(element) {
    const items = [];
    Array.from(element.children).forEach((child) => {
      if (child.tagName !== "LI") {
        return;
      }
      const clone = child.cloneNode(true);
      clone.querySelectorAll("ul,ol").forEach((nested) => nested.remove());
      const item = { children: parseInlineChildren(clone) };
      const nestedBlocks = [];
      child.querySelectorAll(":scope > ul, :scope > ol").forEach((nestedList) => {
        const parsed = parseList(nestedList);
        if (parsed) {
          nestedBlocks.push(parsed);
        }
      });
      if (nestedBlocks.length) {
        item.blocks = nestedBlocks;
      }
      items.push(item);
    });
    return items.length ? { type: "list", ordered: element.tagName === "OL", items } : null;
  }

  function queryScoped(element, selector, fallbackSelector) {
    if (!element || typeof element.querySelector !== "function") {
      return null;
    }
    try {
      return element.querySelector(selector);
    } catch (error) {
      return fallbackSelector ? element.querySelector(fallbackSelector) : null;
    }
  }

  function queryScopedAll(element, selector, fallbackSelector) {
    if (!element || typeof element.querySelectorAll !== "function") {
      return [];
    }
    try {
      return Array.from(element.querySelectorAll(selector));
    } catch (error) {
      return fallbackSelector ? Array.from(element.querySelectorAll(fallbackSelector)) : [];
    }
  }

  function parseFeishuList(element) {
    const blockType = getFeishuBlockType(element);
    const content =
      queryScoped(
        element,
        ":scope > .list-wrapper > .list > .list-content",
        ".list-wrapper .list-content"
      ) || element;
    const nestedElements = queryScopedAll(
      element,
      ":scope > .list-wrapper > .list-children > .render-unit-wrapper > .block",
      ".list-children > .render-unit-wrapper > .block"
    );
    const nestedBlocks = nestedElements.map((child) => elementToBlock(child)).filter(Boolean);
    const item = { children: parseInlineChildren(content) };
    if (nestedBlocks.length) {
      item.blocks = nestedBlocks;
    }
    return {
      type: "list",
      ordered: blockType === "ordered",
      items: [item],
    };
  }

  function parseFeishuQuoteContainer(element) {
    const children = queryScopedAll(
      element,
      ":scope > .quote-container-block > .quote-container-block-children > .render-unit-wrapper > .block",
      ".quote-container-block-children > .render-unit-wrapper > .block"
    )
      .map((child) => elementToBlock(child))
      .filter(Boolean);
    if (children.length) {
      return { type: "quote", blocks: children };
    }
    return { type: "quote", children: parseInlineChildren(element) };
  }

  function parseImage(element) {
    const src = collectElementImageSources(element)[0] || "";
    if (!src) {
      return null;
    }
    return {
      type: "image",
      src,
      alt: element.alt || element.getAttribute("aria-label") || "",
    };
  }

  function getFeishuBlockType(element) {
    return compactText(
      element &&
        (getAttribute(element, "data-block-type") ||
          getAttribute(element, "data-docx-block-type") ||
          getAttribute(element, "data-type"))
    ).toLowerCase();
  }

  function headingLevelFromBlockType(blockType) {
    const match = String(blockType || "").match(/^heading([1-6])$/i);
    return match ? Number(match[1]) : 0;
  }

  function isFeishuImageBlockType(blockType) {
    return /^image$/i.test(String(blockType || ""));
  }

  function isFeishuListBlockType(blockType) {
    return /^(bullet|ordered)$/i.test(String(blockType || ""));
  }

  function isFeishuQuoteBlockType(blockType) {
    return /^quote_container$/i.test(String(blockType || ""));
  }

  function isFeishuContainerBlockType(blockType) {
    return /^(page|root|container)$/i.test(String(blockType || ""));
  }

  function isFeishuContentBlockType(blockType) {
    const value = String(blockType || "").toLowerCase();
    return (
      value === "text" ||
      value === "image" ||
      value === "code" ||
      value === "quote" ||
      value === "table" ||
      isFeishuListBlockType(value) ||
      isFeishuQuoteBlockType(value) ||
      value === "todo" ||
      Boolean(headingLevelFromBlockType(value))
    );
  }

  function isIgnoredFeishuBlockType(blockType) {
    return /^(back_ref_list)$/i.test(String(blockType || ""));
  }

  function hasDescendantFeishuContentBlock(element) {
    if (!element || typeof element.querySelectorAll !== "function") {
      return false;
    }
    return Array.from(element.querySelectorAll("[data-block-type]")).some((child) => {
      const blockType = getFeishuBlockType(child);
      return isFeishuContentBlockType(blockType) && !isIgnoredFeishuBlockType(blockType);
    });
  }

  function childHasBlockCandidate(element) {
    return Array.from(element.children || []).some((child) => isBlockCandidate(child));
  }

  function isFeishuBlock(element) {
    return elementMatches(
      element,
      [
        "[data-block-id]",
        "[data-doc-block-id]",
        "[data-page-id]",
        "[data-docx-has-block-data]",
        "[data-record-id]",
      ].join(",")
    );
  }

  function isBlockCandidate(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || isIgnoredElement(element)) {
      return false;
    }
    if (!isElementVisible(element)) {
      return false;
    }
    const blockType = getFeishuBlockType(element);
    if (isFeishuContainerBlockType(blockType)) {
      return false;
    }
    if (isFeishuContentBlockType(blockType)) {
      return true;
    }
    if (hasDescendantFeishuContentBlock(element)) {
      return false;
    }
    if (/^H[1-6]$/.test(element.tagName)) {
      return true;
    }
    if (["P", "PRE", "TABLE", "UL", "OL", "BLOCKQUOTE", "FIGURE", "IMG", "CANVAS"].includes(element.tagName)) {
      return true;
    }
    if (elementMatches(element, "[role='heading'],[role='table'],[role='list'],[role='listitem']")) {
      return true;
    }
    if (isFeishuBlock(element) && !childHasBlockCandidate(element)) {
      return true;
    }
    const text = getElementText(element);
    const hasImage = elementHasImageSource(element);
    if (!text && !hasImage) {
      return false;
    }
    if (!BLOCK_TAGS.has(element.tagName)) {
      return false;
    }
    return !childHasBlockCandidate(element);
  }

  function inferGenericBlock(element) {
    const imageSources = collectElementImageSources(element);
    const imageOnly = !getElementText(element) && imageSources.length === 1;
    if (imageOnly) {
      return parseImage(element);
    }
    const text = getElementText(element);
    if (!text && !imageSources.length) {
      return null;
    }
    const looksHeading =
      element.getAttribute("role") === "heading" ||
      /^title|heading$/i.test(element.getAttribute("data-type") || "") ||
      /\b(title|heading)\b/i.test(element.className || "");
    if (looksHeading && text.length < 180) {
      return {
        type: "heading",
        level: Math.min(Math.max(Number(element.getAttribute("aria-level")) || 2, 1), 6),
        children: parseInlineChildren(element),
      };
    }
    return { type: "paragraph", children: parseInlineChildren(element) };
  }

  function elementToBlock(element) {
    if (!isBlockCandidate(element)) {
      return null;
    }
    const blockType = getFeishuBlockType(element);
    if (headingLevelFromBlockType(blockType)) {
      return parseHeading(element);
    }
    if (isFeishuImageBlockType(blockType)) {
      return parseImage(element);
    }
    if (isFeishuListBlockType(blockType)) {
      return parseFeishuList(element);
    }
    if (isFeishuQuoteBlockType(blockType)) {
      return parseFeishuQuoteContainer(element);
    }
    if (/^H[1-6]$/.test(element.tagName) || element.getAttribute("role") === "heading") {
      return parseHeading(element);
    }
    if (element.tagName === "PRE") {
      return parseCode(element);
    }
    if (element.tagName === "TABLE" || element.getAttribute("role") === "table") {
      return parseTable(element);
    }
    if (element.tagName === "UL" || element.tagName === "OL" || element.getAttribute("role") === "list") {
      return parseList(element);
    }
    if (element.tagName === "BLOCKQUOTE") {
      return { type: "quote", children: parseInlineChildren(element) };
    }
    if (element.tagName === "IMG" || element.tagName === "CANVAS" || element.tagName === "FIGURE") {
      const image = parseImage(element);
      if (image && !getElementText(element)) {
        return image;
      }
    }
    return inferGenericBlock(element);
  }

  function blockText(block) {
    if (!block) {
      return "";
    }
    if (block.text) {
      return compactText(block.text);
    }
    if (block.children) {
      return compactText(
        block.children
          .map((child) => child.text || child.src || "")
          .join(" ")
      );
    }
    if (block.rows) {
      return compactText(block.rows.flat().join(" "));
    }
    if (block.items) {
      return compactText(
        block.items
          .map((item) => (item.children || []).map((child) => child.text || "").join(" "))
          .join(" ")
      );
    }
    return "";
  }

  function blockImages(block) {
    const images = [];
    if (!block) {
      return images;
    }
    if (block.type === "image" && block.src) {
      images.push({ src: block.src, alt: block.alt || "" });
    }
    (block.children || []).forEach((child) => {
      if ((child.type === "image" || child.src) && child.src) {
        images.push({ src: child.src, alt: child.alt || "" });
      }
    });
    (block.items || []).forEach((item) => {
      (item.children || []).forEach((child) => {
        if ((child.type === "image" || child.src) && child.src) {
          images.push({ src: child.src, alt: child.alt || "" });
        }
      });
    });
    return images;
  }

  function createBlockKey(block, element) {
    const text = blockText(block).slice(0, 220);
    const images = blockImages(block)
      .map((image) => image.src)
      .join(",");
    const tag = element && element.tagName ? element.tagName : "";
    const id =
      element &&
      (element.getAttribute("data-block-id") ||
        element.getAttribute("data-doc-block-id") ||
        element.getAttribute("data-record-id") ||
        element.id);
    if (id) {
      return `id:${id}`;
    }
    if (images) {
      return `${block.type}:img:${images}:${text}`;
    }
    const rect = element && element.getBoundingClientRect ? element.getBoundingClientRect() : null;
    const position = rect && text.length < 12 ? `:${Math.round((rect.top + root.scrollY) / 40)}` : "";
    return `${block.type}:${tag}:${text}${position}`;
  }

  function findOrphanImageBlocks(rootNode, knownSources) {
    // Rescue pass: pick up images that live inside elements the main walk
    // skipped (e.g. Feishu's back-reference / "mentioned in" panel at the
    // bottom of the page). Returns deduplicated image blocks whose src does
    // not already appear in the collected blocks.
    if (!rootNode || typeof rootNode.querySelectorAll !== "function") {
      return [];
    }
    const seen = new Set(knownSources || []);
    const orphans = [];
    const selector = [
      "img",
      "canvas",
      "picture",
      "[role='img']",
      "[data-src]",
      "[data-original-src]",
      "[data-image-src]",
      "[srcset]",
      "[data-srcset]",
    ].join(",");
    let candidates;
    try {
      candidates = rootNode.querySelectorAll(selector);
    } catch (error) {
      return [];
    }
    candidates.forEach((element) => {
      if (!isElementVisible(element)) {
        return;
      }
      const src = pickBestImageSource(element);
      if (!src || seen.has(src) || isLikelyUiImageSource(src)) {
        return;
      }
      if (isTinySvgIconElement(element, src)) {
        return;
      }
      seen.add(src);
      orphans.push({
        type: "image",
        src,
        alt:
          (element && element.alt) ||
          (element && typeof element.getAttribute === "function" && element.getAttribute("aria-label")) ||
          "",
      });
    });
    return orphans;
  }

  function extractBlocksFromRoot(rootNode) {
    const contentRoot = findContentRoot(rootNode);
    const blocks = [];

    function walk(parent) {
      Array.from(parent.children || []).forEach((child) => {
        if (isIgnoredElement(child) || !isElementVisible(child)) {
          return;
        }
        const block = elementToBlock(child);
        if (block) {
          block.key = createBlockKey(block, child);
          blocks.push(block);
          return;
        }
        walk(child);
      });
    }

    const rootBlock = contentRoot !== document.body ? elementToBlock(contentRoot) : null;
    if (rootBlock && !childHasBlockCandidate(contentRoot)) {
      rootBlock.key = createBlockKey(rootBlock, contentRoot);
      blocks.push(rootBlock);
    } else {
      walk(contentRoot);
    }

    if (!blocks.length && getElementText(contentRoot)) {
      const fallback = { type: "paragraph", children: parseInlineChildren(contentRoot) };
      fallback.key = createBlockKey(fallback, contentRoot);
      blocks.push(fallback);
    }

    const knownSources = collectImages(blocks).map((image) => image.src);
    findOrphanImageBlocks(rootNode, knownSources).forEach((orphan) => {
      orphan.key = createBlockKey(orphan, null);
      blocks.push(orphan);
    });

    return blocks.filter((block) => blockText(block) || blockImages(block).length);
  }

  function collectImages(blocks) {
    const seen = new Set();
    const images = [];
    (blocks || []).forEach((block) => {
      blockImages(block).forEach((image) => {
        if (!image.src || seen.has(image.src) || isLikelyUiImageSource(image.src)) {
          return;
        }
        seen.add(image.src);
        images.push(image);
      });
    });
    return images;
  }

  function extractTitle(blocks) {
    const h1 = (blocks || []).find((block) => block.type === "heading" && Number(block.level) === 1);
    if (h1) {
      const title = blockText(h1);
      if (title) {
        return title;
      }
    }
    const ogTitle = document.querySelector("meta[property='og:title']");
    const metaTitle = ogTitle && ogTitle.getAttribute("content");
    const rawTitle = metaTitle || document.title || "";
    return compactText(rawTitle.replace(/[-|_].*(飞书|Lark|Feishu).*$/i, ""));
  }

  const api = {
    compactText,
    pickImageFromSrcset,
    extractCssImageUrl,
    pickBestImageSource,
    getCanvasImageSource,
    isLikelyUiImageSource,
    isTinySvgIconElement,
    isFeishuDocumentImageResource,
    getFeishuDocumentImageResources,
    getVisibleFeishuBlobImages,
    pickFeishuDocumentImageResource,
    getFeishuBlockType,
    headingLevelFromBlockType,
    isFeishuImageBlockType,
    isFeishuListBlockType,
    isFeishuQuoteBlockType,
    isFeishuContainerBlockType,
    isFeishuContentBlockType,
    isIgnoredFeishuBlockType,
    cleanLinkUrl,
    isIgnoredElement,
    isFeishuBlock,
    isBlockCandidate,
    hasDescendantFeishuContentBlock,
    parseFeishuList,
    parseFeishuQuoteContainer,
    collectElementImageSources,
    findContentRoot,
    extractBlocksFromRoot,
    findOrphanImageBlocks,
    collectImages,
    extractTitle,
    createBlockKey,
    blockText,
  };

  root.FeishuDocExport = root.FeishuDocExport || {};
  root.FeishuDocExport.domParser = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
