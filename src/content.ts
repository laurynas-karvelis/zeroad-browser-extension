/* eslint-disable no-console */
// Firefox extension only
(() => {
  const CONTENT_JS_LOOKUP = "js/content.js";
  const trustedOriginHostnames = browser.runtime
    .getManifest()
    .content_scripts?.find((entry) => entry.js?.[0].endsWith(CONTENT_JS_LOOKUP))
    ?.matches.map((trustedOrigin) => new URL(trustedOrigin).hostname);

  // Listen for messages to proxy to the extension background worker
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;

    if (!trustedOriginHostnames || trustedOriginHostnames.length === 0) {
      console.error("[content.js] No trusted origins configured!");
      return;
    }

    const originHostname = new URL(event.origin).hostname;
    if (!trustedOriginHostnames.includes(originHostname)) {
      console.warn("[content.js] Rejected message from untrusted origin:", originHostname);
      return;
    }

    if (event.data?.direction === "SITE_TO_EXTENSION") {
      const response = await browser.runtime.sendMessage(event.data.payload);
      window.postMessage({ direction: "EXTENSION_TO_SITE", payload: response }, event.origin);
    }
  });
})();
