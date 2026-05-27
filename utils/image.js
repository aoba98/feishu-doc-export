(function (root) {
  "use strict";

  const CONTENT_TYPE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/avif": "avif",
  };

  const URL_EXTENSION_RE = /\.([a-z0-9]{2,5})(?:$|[?#])/i;
  const ALLOWED_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "svg",
    "bmp",
    "avif",
  ]);

  function normalizeExtension(extension) {
    if (!extension) {
      return "";
    }
    const ext = String(extension).toLowerCase().replace(/^\./, "");
    return ext === "jpeg" ? "jpg" : ext;
  }

  function getImageExtension(src, contentType) {
    const type = String(contentType || "").split(";")[0].trim().toLowerCase();
    if (CONTENT_TYPE_EXTENSIONS[type]) {
      return CONTENT_TYPE_EXTENSIONS[type];
    }

    const source = String(src || "");
    const dataMatch = source.match(/^data:([^;,]+)[;,]/i);
    if (dataMatch && CONTENT_TYPE_EXTENSIONS[dataMatch[1].toLowerCase()]) {
      return CONTENT_TYPE_EXTENSIONS[dataMatch[1].toLowerCase()];
    }

    const cleanUrl = source.split("#")[0].split("?")[0];
    const match = cleanUrl.match(URL_EXTENSION_RE) || cleanUrl.match(/\.([a-z0-9]{2,5})$/i);
    const ext = normalizeExtension(match && match[1]);
    if (ALLOWED_EXTENSIONS.has(ext)) {
      return ext;
    }

    return "png";
  }

  function makeImageFilename(index, src, contentType) {
    const padded = String(index).padStart(3, "0");
    return `assets/image_${padded}.${getImageExtension(src, contentType)}`;
  }

  function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!match) {
      throw new Error("Invalid data URL");
    }
    const contentType = match[1] || "application/octet-stream";
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: contentType });
  }

  function uniqueImages(images) {
    const seen = new Set();
    const unique = [];
    (images || []).forEach((image) => {
      const src = typeof image === "string" ? image : image && image.src;
      if (!src || seen.has(src)) {
        return;
      }
      seen.add(src);
      unique.push(typeof image === "string" ? { src } : image);
    });
    return unique;
  }

  async function fetchImageBlob(src, resolveBlobUrl) {
    if (/^data:image\//i.test(src)) {
      return dataUrlToBlob(src);
    }

    if (/^blob:/i.test(src) && resolveBlobUrl) {
      const dataUrl = await resolveBlobUrl(src);
      return dataUrlToBlob(dataUrl);
    }

    const response = await fetch(src, {
      credentials: "include",
      cache: "force-cache",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.blob();
  }

  async function downloadImages(images, options) {
    const opts = Object.assign(
      {
        enabled: true,
        preserveOriginalUrl: true,
        onProgress: null,
        resolveBlobUrl: null,
      },
      options || {}
    );
    const results = {};
    const assets = [];
    const failures = [];
    const unique = uniqueImages(images);

    if (!opts.enabled) {
      unique.forEach((image) => {
        results[image.src] = {
          ok: false,
          originalUrl: image.src,
          reason: "Image export disabled",
        };
      });
      return { results, assets, failures };
    }

    for (let index = 0; index < unique.length; index += 1) {
      const item = unique[index];
      const src = item.src;
      if (opts.onProgress) {
        opts.onProgress(index + 1, unique.length, src);
      }
      try {
        const blob = await fetchImageBlob(src, opts.resolveBlobUrl);
        const filename = makeImageFilename(assets.length + 1, src, blob.type);
        assets.push({ filename, blob, src });
        results[src] = { ok: true, filename, contentType: blob.type || "" };
      } catch (error) {
        const failure = {
          ok: false,
          originalUrl: opts.preserveOriginalUrl ? src : "",
          reason: error && error.message ? error.message : String(error),
        };
        results[src] = failure;
        failures.push(Object.assign({ src }, failure));
      }
    }

    return { results, assets, failures };
  }

  const api = {
    getImageExtension,
    makeImageFilename,
    dataUrlToBlob,
    uniqueImages,
    downloadImages,
  };

  root.FeishuDocExport = root.FeishuDocExport || {};
  root.FeishuDocExport.image = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
