(function (root) {
  "use strict";

  const DEFAULT_ZIP_FILENAME = "feishu-document-export.zip";
  const MAX_BASE_LENGTH = 120;

  function sanitizeFilename(value, fallback = "feishu-document-export") {
    const raw = String(value || "");
    const cleaned = raw
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .replace(/[\/\\:*?"<>|\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim();

    const safe = cleaned || fallback || "";
    return safe.slice(0, MAX_BASE_LENGTH).trim();
  }

  function buildZipFilename(title) {
    const cleaned = sanitizeFilename(title, "");
    if (!cleaned) {
      return DEFAULT_ZIP_FILENAME;
    }
    return `feishu-doc-export-${cleaned}.zip`;
  }

  const api = {
    sanitizeFilename,
    buildZipFilename,
    DEFAULT_ZIP_FILENAME,
  };

  root.FeishuDocExport = root.FeishuDocExport || {};
  root.FeishuDocExport.filename = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
