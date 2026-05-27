(function (root) {
  "use strict";

  async function createDocumentZip(payload) {
    if (!root.JSZip) {
      throw new Error("JSZip is not loaded");
    }
    const zip = new root.JSZip();
    const markdown = payload && payload.markdown ? payload.markdown : "";
    const assets = payload && Array.isArray(payload.assets) ? payload.assets : [];

    zip.file("document.md", markdown);
    const assetsFolder = zip.folder("assets");

    assets.forEach((asset) => {
      if (!asset || !asset.filename || !asset.blob) {
        return;
      }
      const filename = String(asset.filename).replace(/^assets\//, "");
      assetsFolder.file(filename, asset.blob);
    });

    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  const api = { createDocumentZip };

  root.FeishuDocExport = root.FeishuDocExport || {};
  root.FeishuDocExport.zip = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
