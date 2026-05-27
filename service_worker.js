chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "FEISHU_EXPORT_DOWNLOAD_ZIP") {
    return false;
  }

  try {
    // saveAs defaults to true (preserve historical behaviour) but the popup
    // may pass false to drop straight into the browser's default Downloads
    // folder without showing a Save As dialog.
    const saveAs = message.saveAs !== false;
    chrome.downloads.download(
      {
        url: message.url,
        filename: message.filename || "feishu-document-export.zip",
        saveAs,
        conflictAction: "uniquify",
      },
      (downloadId) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          sendResponse({ ok: false, error: lastError.message });
          return;
        }
        sendResponse({ ok: true, downloadId });
      }
    );
  } catch (error) {
    sendResponse({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }

  return true;
});
