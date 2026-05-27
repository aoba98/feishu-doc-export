(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const statusLabels = {
    checking: "正在检查页面",
    scrolling: "正在滚动加载文档",
    parsing: "正在解析文档",
    downloading: "正在下载图片",
    markdown: "正在生成 Markdown",
    zipping: "正在打包 ZIP",
    done: "导出完成",
    error: "导出失败",
  };

  let activeTab = null;
  let isExporting = false;
  const START_MESSAGE_TYPE = "FEISHU_EXPORT_START_V6";
  const FETCH_IMAGE_MESSAGE_TYPE = "FEISHU_EXPORT_FETCH_IMAGE_V6";

  function setStatus(status, detail) {
    const statusText = $("statusText");
    const dot = $("statusDot");
    statusText.textContent = detail ? `${statusLabels[status] || status}：${detail}` : statusLabels[status] || status;
    dot.classList.toggle("active", !["done", "error", "checking"].includes(status));
    dot.classList.toggle("error", status === "error");
  }

  function appendLog(line) {
    const log = $("log");
    const next = `[${new Date().toLocaleTimeString()}] ${line}`;
    log.textContent = log.textContent ? `${log.textContent}\n${next}` : next;
    log.scrollTop = log.scrollHeight;
  }

  function setBadge(kind, text) {
    const badge = $("pageBadge");
    badge.className = `badge ${kind || ""}`.trim();
    badge.textContent = text;
  }

  function isSupportedHost(url) {
    try {
      const parsed = new URL(url || "");
      return parsed.protocol === "https:" && (parsed.hostname.endsWith("feishu.cn") || parsed.hostname.endsWith("larksuite.com"));
    } catch (error) {
      return false;
    }
  }

  function isDocumentLike(url) {
    try {
      const parsed = new URL(url || "");
      return /(docs|docx|wiki|base|sheets|mindnotes|minutes|drive)/i.test(parsed.pathname);
    } catch (error) {
      return false;
    }
  }

  function chromeCallback(resolve, reject) {
    return (value) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(value);
    };
  }

  function queryActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, chromeCallback((tabs) => resolve(tabs[0]), reject));
    });
  }

  function executeScripts(tabId, files) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          files,
        },
        chromeCallback(resolve, reject)
      );
    });
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, chromeCallback(resolve, reject));
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, chromeCallback(resolve, reject));
    });
  }

  async function refreshPageState() {
    setStatus("checking");
    activeTab = await queryActiveTab();
    const title = activeTab && activeTab.title ? activeTab.title : "当前页面无标题";
    $("pageTitle").textContent = title;

    const supported = activeTab && isSupportedHost(activeTab.url);
    const docLike = activeTab && isDocumentLike(activeTab.url);
    $("exportButton").disabled = !supported || isExporting;

    if (!supported) {
      setBadge("error", "非飞书页面");
      setStatus("checking", "请打开飞书 / Lark 文档页面");
      return;
    }
    if (!docLike) {
      setBadge("warn", "可能不是文档");
      setStatus("checking", "页面域名匹配，但路径不像文档");
      return;
    }
    setBadge("ok", "可导出");
    setStatus("checking", "已识别飞书 / Lark 文档");
  }

  async function ensureContentScript(tabId) {
    await executeScripts(tabId, ["utils/domParser.js", "content.js"]);
  }

  function readOptions() {
    return {
      autoScroll: $("autoScroll").checked,
      exportImages: $("exportImages").checked,
      preserveOriginalUrl: $("preserveImageUrls").checked,
      saveToDefault: $("saveToDefault").checked,
    };
  }

  function setWarningActive(active) {
    const warning = $("exportWarning");
    if (warning) {
      warning.classList.toggle("export-active", Boolean(active));
    }
  }

  async function resolveBlobUrl(tabId, src) {
    const response = await sendTabMessage(tabId, {
      type: FETCH_IMAGE_MESSAGE_TYPE,
      src,
    });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "无法读取 blob 图片");
    }
    return response.dataUrl;
  }

  async function exportCurrentDocument() {
    if (!activeTab || isExporting) {
      return;
    }
    isExporting = true;
    $("exportButton").disabled = true;
    $("log").textContent = "";
    setWarningActive(true);

    const options = readOptions();
    const tabId = activeTab.id;

    try {
      appendLog("开始导出");
      await ensureContentScript(tabId);

      const response = await sendTabMessage(tabId, {
        type: START_MESSAGE_TYPE,
        options,
      });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "内容脚本没有返回导出结果");
      }

      const documentData = response.document;
      appendLog(`解析完成：${response.meta.blockCount} 个内容块，${response.meta.imageCount} 张图片`);

      setStatus("downloading");
      const imagePayload = await FeishuDocExport.image.downloadImages(documentData.images, {
        enabled: options.exportImages,
        preserveOriginalUrl: options.preserveOriginalUrl,
        resolveBlobUrl: (src) => resolveBlobUrl(tabId, src),
        onProgress: (current, total) => {
          setStatus("downloading", `${current}/${total}`);
        },
      });
      imagePayload.failures.forEach((failure) => {
        appendLog(`图片下载失败：${failure.src} (${failure.reason})`);
      });

      setStatus("markdown");
      const markdown = FeishuDocExport.markdown.renderMarkdown(documentData, imagePayload.results, {
        preserveOriginalUrl: options.preserveOriginalUrl,
      });

      setStatus("zipping");
      const zipBlob = await FeishuDocExport.zip.createDocumentZip({
        markdown,
        assets: imagePayload.assets,
      });

      const objectUrl = URL.createObjectURL(zipBlob);
      const filename = FeishuDocExport.filename.buildZipFilename(documentData.title || activeTab.title);
      const downloadResponse = await sendRuntimeMessage({
        type: "FEISHU_EXPORT_DOWNLOAD_ZIP",
        url: objectUrl,
        filename,
        saveAs: !options.saveToDefault,
      });
      if (!downloadResponse || !downloadResponse.ok) {
        throw new Error((downloadResponse && downloadResponse.error) || "下载 ZIP 失败");
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

      setStatus("done", filename);
      appendLog(`导出完成：${filename}`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setStatus("error", message);
      appendLog(`导出失败：${message}`);
    } finally {
      isExporting = false;
      setWarningActive(false);
      $("exportButton").disabled = !activeTab || !isSupportedHost(activeTab.url);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "FEISHU_EXPORT_STATUS") {
      return false;
    }
    setStatus(message.status, message.detail);
    return false;
  });

  document.addEventListener("DOMContentLoaded", async () => {
    $("exportButton").addEventListener("click", exportCurrentDocument);
    try {
      await refreshPageState();
    } catch (error) {
      setBadge("error", "检查失败");
      setStatus("error", error && error.message ? error.message : String(error));
    }
  });
})();
