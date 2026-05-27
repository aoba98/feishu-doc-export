(function (root) {
  "use strict";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ");
  }

  function escapeInline(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\*/g, "\\*")
      .replace(/_/g, "\\_")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/</g, "\\<")
      .replace(/>/g, "\\>");
  }

  function escapeTableCell(value) {
    return String(value || "")
      .replace(/\r?\n/g, " ")
      .replace(/\|/g, "\\|")
      .trim();
  }

  function escapeCodeFence(value) {
    return String(value || "").replace(/```/g, "`\u200b``");
  }

  function wrapCode(value) {
    const text = String(value || "");
    if (text.includes("`")) {
      return "`` " + text.replace(/``/g, "`\u200b`") + " ``";
    }
    return "`" + text + "`";
  }

  function inlineText(children) {
    return (children || [])
      .map((child) => {
        if (typeof child === "string") {
          return child;
        }
        if (child && child.text) {
          return child.text;
        }
        return "";
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  function imageTarget(block, imageResults, options) {
    const result = imageResults && block.src ? imageResults[block.src] : null;
    if (result && result.ok && result.filename) {
      return localAssetTarget(result.filename);
    }
    if (result && result.originalUrl && options.preserveOriginalUrl !== false) {
      return result.originalUrl;
    }
    if (block.filename && block.filename.startsWith("assets/")) {
      return localAssetTarget(block.filename);
    }
    return block.src || "";
  }

  function localAssetTarget(filename) {
    const value = String(filename || "");
    return value.startsWith("assets/") ? `./${value}` : value;
  }

  function renderInlineNode(node, imageResults, options) {
    if (typeof node === "string") {
      return escapeInline(node);
    }
    if (!node) {
      return "";
    }
    if (node.type === "image" || node.src) {
      const alt = escapeInline(node.alt || "");
      const target = imageTarget(node, imageResults, options);
      return target ? `![${alt}](${target})` : "";
    }

    const rawText = normalizeText(node.text || "");
    let rendered = node.code ? wrapCode(rawText) : escapeInline(rawText);

    if (node.href) {
      const label = rendered || escapeInline(node.href);
      rendered = `[${label}](${String(node.href).replace(/\s/g, "%20")})`;
    }
    if (!node.code && node.bold) {
      rendered = `**${rendered}**`;
    }
    if (!node.code && node.italic) {
      rendered = `*${rendered}*`;
    }
    if (!node.code && node.strike) {
      rendered = `~~${rendered}~~`;
    }
    return rendered;
  }

  function renderInline(children, imageResults, options) {
    return (children || [])
      .map((child) => renderInlineNode(child, imageResults, options))
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  function renderListItem(item, index, ordered, imageResults, options) {
    const prefix = ordered ? `${index + 1}. ` : "- ";
    const text = item.text
      ? escapeInline(item.text)
      : renderInline(item.children || [], imageResults, options);
    const nestedBlocks = item.blocks || [];
    if (!nestedBlocks.length) {
      return prefix + text;
    }
    const nested = nestedBlocks
      .map((block) => renderBlock(block, imageResults, options))
      .filter(Boolean)
      .join("\n")
      .split("\n")
      .map((line) => "  " + line)
      .join("\n");
    return prefix + text + "\n" + nested;
  }

  function renderTable(block) {
    const rows = (block.rows || []).filter((row) => row && row.length);
    if (!rows.length) {
      return "";
    }
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const normalized = rows.map((row) => {
      const next = row.slice();
      while (next.length < width) {
        next.push("");
      }
      return next;
    });
    const header = normalized[0];
    const body = normalized.slice(1);
    const headerLine = "| " + header.map(escapeTableCell).join(" | ") + " |";
    const separator = "| " + header.map(() => "---").join(" | ") + " |";
    const bodyLines = body.map(
      (row) => "| " + row.map(escapeTableCell).join(" | ") + " |"
    );
    return [headerLine, separator].concat(bodyLines).join("\n");
  }

  function renderQuote(block, imageResults, options) {
    const text =
      renderInline(block.children || [], imageResults, options) ||
      (block.blocks || [])
        .map((child) => renderBlock(child, imageResults, options))
        .filter(Boolean)
        .join("\n");
    return text
      .split(/\r?\n/)
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n");
  }

  function renderBlock(block, imageResults, options) {
    if (!block) {
      return "";
    }

    switch (block.type) {
      case "heading": {
        const level = Math.min(Math.max(Number(block.level) || 1, 1), 6);
        const text = renderInline(block.children || [], imageResults, options);
        return text ? `${"#".repeat(level)} ${text}` : "";
      }
      case "paragraph":
        return renderInline(block.children || [], imageResults, options);
      case "image": {
        const target = imageTarget(block, imageResults, options);
        return target ? `![${escapeInline(block.alt || "")}](${target})` : "";
      }
      case "list":
        return (block.items || [])
          .map((item, index) =>
            renderListItem(item, index, Boolean(block.ordered), imageResults, options)
          )
          .join("\n");
      case "table":
        return renderTable(block);
      case "code": {
        const language = String(block.language || "").replace(/[^a-z0-9_+-]/gi, "");
        return "```" + language + "\n" + escapeCodeFence(block.text || "") + "\n```";
      }
      case "quote":
        return renderQuote(block, imageResults, options);
      default:
        if (block.children) {
          return renderInline(block.children, imageResults, options);
        }
        if (block.text) {
          return escapeInline(block.text);
        }
        return "";
    }
  }

  function firstBlockIsSameTitle(blocks, title) {
    if (!blocks || !blocks.length || !title) {
      return false;
    }
    const first = blocks[0];
    return (
      first.type === "heading" &&
      Number(first.level) === 1 &&
      inlineText(first.children) === title.trim()
    );
  }

  function renderMarkdown(documentData, imageResults, options) {
    const doc = documentData || {};
    const opts = Object.assign({ preserveOriginalUrl: true }, options || {});
    const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
    const chunks = [];
    const title = String(doc.title || "").trim();

    if (title && !firstBlockIsSameTitle(blocks, title)) {
      chunks.push({ text: `# ${escapeInline(title)}`, blockType: "heading" });
    }

    blocks.forEach((block) => {
      const rendered = renderBlock(block, imageResults || {}, opts).trim();
      if (rendered) {
        const previous = chunks[chunks.length - 1];
        if (previous && block.type === "list" && previous.blockType === "list") {
          previous.text += `\n${rendered}`;
        } else {
          chunks.push({ text: rendered, blockType: block.type || "" });
        }
      }
    });

    const markdown = chunks.map((chunk) => chunk.text).join("\n\n").trim();
    return markdown + (chunks.length ? "\n" : "");
  }

  const api = {
    renderMarkdown,
    renderBlock,
    renderInline,
    escapeInline,
    escapeTableCell,
  };

  root.FeishuDocExport = root.FeishuDocExport || {};
  root.FeishuDocExport.markdown = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
