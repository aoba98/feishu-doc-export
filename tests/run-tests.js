const assert = require("assert");
const fs = require("fs");
const path = require("path");

const filename = require("../utils/filename.js");
const markdown = require("../exporters/markdown.js");
const image = require("../utils/image.js");
const domParser = require("../utils/domParser.js");
const previousChrome = global.chrome;
global.chrome = {
  runtime: {
    sendMessage() {},
    onMessage: {
      addListener() {},
    },
  },
};
delete global.__FEISHU_DOC_EXPORT_CONTENT_VERSION__;
const content = require("../content.js");
if (previousChrome === undefined) {
  delete global.chrome;
} else {
  global.chrome = previousChrome;
}
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

test("sanitizeFilename removes Chrome download illegal characters", () => {
  assert.strictEqual(
    filename.sanitizeFilename(' Q1 / Plan: "Alpha" | Draft '),
    "Q1 Plan Alpha Draft"
  );
});

test("buildZipFilename uses the fallback name for blank titles", () => {
  assert.strictEqual(filename.buildZipFilename("   "), "feishu-document-export.zip");
});

test("buildZipFilename prefixes cleaned document titles", () => {
  assert.strictEqual(
    filename.buildZipFilename("飞书 / Lark: Doc?"),
    "feishu-doc-export-飞书 Lark Doc.zip"
  );
});

test("buildZipFilename removes invisible Unicode format characters from Feishu titles", () => {
  const noisyTitle =
    "\u200c\u200b\u200b\u200b\u202c\u2060\u200b\u200d\ufeff【Romain way 的大模型算法学习笔记】（一）深度学习基础 - 飞书云文档";

  assert.strictEqual(
    filename.buildZipFilename(noisyTitle),
    "feishu-doc-export-【Romain way 的大模型算法学习笔记】（一）深度学习基础 - 飞书云文档.zip"
  );
});

test("renderMarkdown converts structured blocks into Markdown", () => {
  const document = {
    title: "Demo Doc",
    blocks: [
      {
        type: "heading",
        level: 2,
        children: [{ text: "Overview" }],
      },
      {
        type: "paragraph",
        children: [
          { text: "Hello " },
          { text: "bold", bold: true },
          { text: " and " },
          { text: "code", code: true },
          { text: " " },
          { text: "site", href: "https://example.com?a=1&b=2" },
        ],
      },
      {
        type: "image",
        src: "https://example.com/image.png",
        alt: "Diagram",
        filename: "assets/image_001.png",
      },
      {
        type: "table",
        rows: [
          ["Name", "Value"],
          ["A|B", "2"],
        ],
      },
    ],
  };

  const output = markdown.renderMarkdown(document, {
    "https://example.com/image.png": {
      ok: true,
      filename: "assets/image_001.png",
    },
  });

  assert.ok(output.includes("# Demo Doc"));
  assert.ok(output.includes("## Overview"));
  assert.ok(output.includes("Hello **bold** and `code` [site](https://example.com?a=1&b=2)"));
  assert.ok(output.includes("![Diagram](./assets/image_001.png)"));
  assert.ok(output.includes("| Name | Value |"));
  assert.ok(output.includes("| A\\|B | 2 |"));
});

test("renderMarkdown falls back to original image URL when download fails", () => {
  const output = markdown.renderMarkdown(
    {
      title: "",
      blocks: [{ type: "image", src: "https://cdn.example.com/a.png", alt: "" }],
    },
    {
      "https://cdn.example.com/a.png": {
        ok: false,
        originalUrl: "https://cdn.example.com/a.png",
      },
    }
  );

  assert.strictEqual(output.trim(), "![](https://cdn.example.com/a.png)");
});

test("renderMarkdown keeps consecutive list blocks contiguous", () => {
  const output = markdown.renderMarkdown({
    title: "",
    blocks: [
      { type: "list", ordered: false, items: [{ children: [{ text: "First" }] }] },
      { type: "list", ordered: false, items: [{ children: [{ text: "Second" }] }] },
      { type: "paragraph", children: [{ text: "After" }] },
    ],
  });

  assert.ok(output.includes("- First\n- Second\n\nAfter"));
});

test("image helpers infer common extensions", () => {
  assert.strictEqual(image.getImageExtension("https://example.com/a/photo.webp?x=1"), "webp");
  assert.strictEqual(image.getImageExtension("https://example.com/a/photo", "image/jpeg"), "jpg");
  assert.strictEqual(image.getImageExtension("data:image/png;base64,aaa"), "png");
});

test("image helpers generate stable asset names", () => {
  assert.strictEqual(
    image.makeImageFilename(3, "https://example.com/pic.jpeg"),
    "assets/image_003.jpg"
  );
});

test("dom parser picks lazy-loaded Feishu image attributes", () => {
  const source = domParser.pickBestImageSource({
    tagName: "IMG",
    currentSrc: "",
    src: "",
    getAttribute(name) {
      return {
        "data-src": "https://s3-imfile.feishucdn.com/doc-image/main.png?format=jpeg",
      }[name];
    },
  });

  assert.strictEqual(source, "https://s3-imfile.feishucdn.com/doc-image/main.png?format=jpeg");
});

test("dom parser picks the largest srcset candidate", () => {
  assert.strictEqual(
    domParser.pickImageFromSrcset(
      "https://example.com/small.png 320w, https://example.com/large.png 1280w"
    ),
    "https://example.com/large.png"
  );
});

test("dom parser extracts CSS background image URLs", () => {
  assert.strictEqual(
    domParser.extractCssImageUrl('background-image: url("https://example.com/bg.webp?x=1")'),
    "https://example.com/bg.webp?x=1"
  );
});

test("dom parser rejects Feishu default-face avatar images", () => {
  assert.strictEqual(
    domParser.isLikelyUiImageSource(
      "https://s3-imfile.feishucdn.com/static-resource/v1/avatar?image_size=72x72&cut_type=default-face"
    ),
    true
  );
});

test("dom parser rejects Feishu empty/loading illustration images", () => {
  assert.strictEqual(
    domParser.isLikelyUiImageSource(
      "//lf-package-cn.feishucdn.com/obj/feishu-static/eesz/bear/docx/module/media/illustration_empty_positive_loading_light.7a6226d7.svg"
    ),
    true
  );
});

test("dom parser normalizes protocol-relative CDN image URLs", () => {
  const source = domParser.pickBestImageSource({
    tagName: "IMG",
    currentSrc: "",
    src: "",
    getAttribute(name) {
      return {
        "data-src": "//s3-imfile.feishucdn.com/doc-image/main.png?format=png",
      }[name];
    },
  });

  assert.strictEqual(source, "https://s3-imfile.feishucdn.com/doc-image/main.png?format=png");
});

test("dom parser exports visible canvas content as png data urls", () => {
  const source = domParser.pickBestImageSource({
    tagName: "CANVAS",
    width: 640,
    height: 320,
    toDataURL(type) {
      assert.strictEqual(type, "image/png");
      return "data:image/png;base64,abc123";
    },
    getAttribute() {
      return "";
    },
  });

  assert.strictEqual(source, "data:image/png;base64,abc123");
});

test("dom parser ignores tiny canvas elements used as UI decoration", () => {
  const source = domParser.pickBestImageSource({
    tagName: "CANVAS",
    width: 12,
    height: 12,
    toDataURL() {
      return "data:image/png;base64,tiny";
    },
    getAttribute() {
      return "";
    },
  });

  assert.strictEqual(source, "");
});

test("dom parser does not treat generic block class wrappers as Feishu content blocks", () => {
  const wrapper = {
    matches(selector) {
      return selector.includes("[class*='block' i]");
    },
  };

  assert.strictEqual(domParser.isFeishuBlock(wrapper), false);
});

test("dom parser ignores tiny svg icon image elements", () => {
  const source = domParser.pickBestImageSource({
    tagName: "IMG",
    currentSrc: "",
    naturalWidth: 18,
    naturalHeight: 18,
    src: "",
    getAttribute(name) {
      return {
        src: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiPjwvc3ZnPg==",
      }[name];
    },
    getBoundingClientRect() {
      return { width: 18, height: 18 };
    },
  });

  assert.strictEqual(source, "");
});

test("dom parser preserves Feishu blob image URLs instead of collapsing them to resource URLs", () => {
  const previousPerformance = global.performance;
  const previousDocument = global.document;
  const imageElement = {
    tagName: "IMG",
    currentSrc: "blob:https://example.com/current-image",
    src: "",
    getAttribute() {
      return "";
    },
    getBoundingClientRect() {
      return { width: 320, height: 180 };
    },
  };

  global.performance = {
    getEntriesByType(type) {
      assert.strictEqual(type, "resource");
      return [
        {
          name: "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/old/?mount_point=docx_image&width=1280&height=1280",
        },
      ];
    },
  };
  global.document = {
    querySelectorAll() {
      return [imageElement];
    },
  };

  try {
    assert.strictEqual(domParser.pickBestImageSource(imageElement), imageElement.currentSrc);
  } finally {
    global.performance = previousPerformance;
    if (previousDocument === undefined) {
      delete global.document;
    } else {
      global.document = previousDocument;
    }
  }
});

test("dom parser removes invisible Feishu text placeholders", () => {
  assert.strictEqual(domParser.compactText("\u200b\u200c\u200d\ufeff"), "");
  assert.strictEqual(domParser.compactText("  A\u200b B  "), "A B");
});

test("dom parser recognizes Feishu heading block types", () => {
  assert.strictEqual(domParser.headingLevelFromBlockType("heading1"), 1);
  assert.strictEqual(domParser.headingLevelFromBlockType("heading2"), 2);
  assert.strictEqual(domParser.headingLevelFromBlockType("heading6"), 6);
  assert.strictEqual(domParser.headingLevelFromBlockType("text"), 0);
});

test("dom parser recognizes Feishu image block types", () => {
  assert.strictEqual(domParser.isFeishuImageBlockType("image"), true);
  assert.strictEqual(domParser.isFeishuImageBlockType("text"), false);
});

test("dom parser recognizes Feishu list and quote block types", () => {
  assert.strictEqual(domParser.isFeishuListBlockType("bullet"), true);
  assert.strictEqual(domParser.isFeishuListBlockType("ordered"), true);
  assert.strictEqual(domParser.isFeishuListBlockType("text"), false);
  assert.strictEqual(domParser.isFeishuQuoteBlockType("quote_container"), true);
  assert.strictEqual(domParser.isFeishuQuoteBlockType("text"), false);
});

test("dom parser recognizes Feishu page blocks as containers", () => {
  assert.strictEqual(domParser.isFeishuContainerBlockType("page"), true);
  assert.strictEqual(domParser.isFeishuContainerBlockType("text"), false);
  assert.strictEqual(domParser.isFeishuContentBlockType("text"), true);
  assert.strictEqual(domParser.isFeishuContentBlockType("heading2"), true);
  assert.strictEqual(domParser.isFeishuContentBlockType("image"), true);
  assert.strictEqual(domParser.isFeishuContentBlockType("bullet"), true);
  assert.strictEqual(domParser.isFeishuContentBlockType("quote_container"), true);
  assert.strictEqual(domParser.isFeishuContentBlockType("page"), false);
});

test("dom parser does not export Feishu page containers as document blocks", () => {
  const previousNode = global.Node;
  global.Node = { ELEMENT_NODE: 1 };
  try {
    const pageBlock = {
      nodeType: 1,
      tagName: "DIV",
      children: [],
      hidden: false,
      className: "block docx-page-block",
      getAttribute(name) {
        return {
          "data-block-id": "1",
          "data-block-type": "page",
        }[name];
      },
      matches(selector) {
        return selector.includes("[data-block-id]");
      },
      getBoundingClientRect() {
        return { width: 900, height: 600 };
      },
    };

    assert.strictEqual(domParser.isBlockCandidate(pageBlock), false);
  } finally {
    if (previousNode === undefined) {
      delete global.Node;
    } else {
      global.Node = previousNode;
    }
  }
});

test("dom parser ignores Feishu catalogue and like UI containers", () => {
  const previousNode = global.Node;
  global.Node = { ELEMENT_NODE: 1 };
  try {
    const catalogue = {
      nodeType: 1,
      tagName: "DIV",
      matches(selector) {
        return selector.includes("[class*='catalogue' i]");
      },
    };
    const like = {
      nodeType: 1,
      tagName: "DIV",
      matches(selector) {
        return selector.includes("[class*='global-like' i]");
      },
    };

    assert.strictEqual(domParser.isIgnoredElement(catalogue), true);
    assert.strictEqual(domParser.isIgnoredElement(like), true);
  } finally {
    if (previousNode === undefined) {
      delete global.Node;
    } else {
      global.Node = previousNode;
    }
  }
});

test("dom parser does not ignore Feishu link anchors with contextmenu classes", () => {
  const previousNode = global.Node;
  global.Node = { ELEMENT_NODE: 1 };
  try {
    const link = {
      nodeType: 1,
      tagName: "A",
      getAttribute(name) {
        return {
          href: "https://example.com",
          class: "link contextmenu-without-copyperm",
        }[name];
      },
      matches(selector) {
        return selector.includes("[class*='contextmenu' i]");
      },
    };

    assert.strictEqual(domParser.isIgnoredElement(link), false);
  } finally {
    if (previousNode === undefined) {
      delete global.Node;
    } else {
      global.Node = previousNode;
    }
  }
});

test("dom parser ignores Feishu back reference blocks", () => {
  const previousNode = global.Node;
  global.Node = { ELEMENT_NODE: 1 };
  try {
    const backReference = {
      nodeType: 1,
      tagName: "DIV",
      getAttribute(name) {
        return {
          "data-block-type": "back_ref_list",
        }[name];
      },
      matches() {
        return false;
      },
    };

    assert.strictEqual(domParser.isIgnoredElement(backReference), true);
  } finally {
    if (previousNode === undefined) {
      delete global.Node;
    } else {
      global.Node = previousNode;
    }
  }
});

test("dom parser maps visible Feishu blob images to document image resource URLs", () => {
  const first = { currentSrc: "blob:https://example.com/one" };
  const second = { currentSrc: "blob:https://example.com/two" };
  const resources = [
    "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/one/?mount_point=docx_image&width=1280&height=1280",
    "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/two/?mount_point=docx_image&width=1280&height=1280",
  ];

  assert.strictEqual(
    domParser.pickFeishuDocumentImageResource(second, resources, [first, second]),
    resources[1]
  );
});

test("dom parser uses latest Feishu document image resources when the buffer has older images", () => {
  const image = { currentSrc: "blob:https://example.com/current" };
  const resources = [
    "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/old/?mount_point=docx_image&width=1280&height=1280",
    "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/current/?mount_point=docx_image&width=1280&height=1280",
  ];

  assert.strictEqual(
    domParser.pickFeishuDocumentImageResource(image, resources, [image]),
    resources[1]
  );
});

test("content script uses dense scroll steps for virtualized Feishu images", () => {
  assert.strictEqual(content.calculateScrollStep({ clientHeight: 596 }), 298);
  assert.strictEqual(content.calculateScrollStep({ clientHeight: 1200 }), 480);
});

test("manifest grants image CDN host permissions for local asset downloads", () => {
  assert.ok(manifest.host_permissions.includes("https://*.feishucdn.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.larksuitecdn.com/*"));
});

test("dom parser rescues orphan images skipped by ignored block ancestors", () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousPerformance = global.performance;
  const previousNode = global.Node;
  const previousGetComputedStyle = global.getComputedStyle;

  const knownSrc = "https://example.com/already-collected.png";
  const orphanSrc = "https://example.com/back-ref-image.png";

  function makeImg(src) {
    return {
      nodeType: 1,
      tagName: "IMG",
      currentSrc: src,
      src,
      alt: "",
      hidden: false,
      naturalWidth: 800,
      naturalHeight: 600,
      complete: true,
      getAttribute(name) {
        if (name === "src") return src;
        return "";
      },
      getBoundingClientRect() {
        return { width: 800, height: 600 };
      },
    };
  }

  const orphanImg = makeImg(orphanSrc);

  global.Node = { ELEMENT_NODE: 1 };
  global.window = { getComputedStyle: () => ({ overflowY: "", display: "block", visibility: "visible" }) };
  global.getComputedStyle = global.window.getComputedStyle;
  global.performance = { getEntriesByType: () => [] };
  global.document = {
    body: {},
    documentElement: {},
    querySelectorAll: () => [orphanImg],
  };

  try {
    const orphans = domParser.findOrphanImageBlocks(
      {
        querySelectorAll: () => [orphanImg],
      },
      [knownSrc]
    );
    assert.strictEqual(orphans.length, 1);
    assert.strictEqual(orphans[0].type, "image");
    assert.strictEqual(orphans[0].src, orphanSrc);

    const deduped = domParser.findOrphanImageBlocks(
      {
        querySelectorAll: () => [orphanImg],
      },
      [knownSrc, orphanSrc]
    );
    assert.strictEqual(deduped.length, 0);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousPerformance === undefined) delete global.performance;
    else global.performance = previousPerformance;
    if (previousNode === undefined) delete global.Node;
    else global.Node = previousNode;
    if (previousGetComputedStyle === undefined) delete global.getComputedStyle;
    else global.getComputedStyle = previousGetComputedStyle;
  }
});
