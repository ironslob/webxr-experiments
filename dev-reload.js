(() => {
  const targets = ["./", "./main.js", "./logic.js", "./model.glb", "../../styles.css", "../../dev-reload.js"];
  const fingerprints = new Map();
  const checkbox = document.querySelector("#dev");
  let timer = 0;
  let badge = null;
  let intervalMs = 1000;

  function readUrlDev() {
    return new URLSearchParams(location.search).has("dev");
  }

  function readInterval() {
    const raw = new URLSearchParams(location.search).get("dev");
    if (raw == null || raw === "" || raw === "1" || raw === "true") return 1000;
    return Math.max(500, Number(raw) || 1000);
  }

  function setUrlDev(enabled) {
    const url = new URL(location.href);
    if (enabled) url.searchParams.set("dev", "1");
    else url.searchParams.delete("dev");
    history.replaceState(null, "", url);
  }

  function showBadge(enabled) {
    if (!enabled) {
      badge?.remove();
      badge = null;
      return;
    }
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "dev-badge";
      document.body.append(badge);
    }
    badge.textContent = `dev · ${intervalMs}ms`;
  }

  async function fingerprint(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const header = response.headers.get("etag") || response.headers.get("last-modified");
    if (header) return header;
    return `${response.headers.get("content-length") || ""}:${await response.text()}`;
  }

  async function check() {
    for (const url of targets) {
      try {
        const next = await fingerprint(url);
        if (next == null) continue;
        const prev = fingerprints.get(url);
        if (prev === undefined) {
          fingerprints.set(url, next);
          continue;
        }
        if (prev !== next) {
          location.reload();
          return;
        }
      } catch {
        // Ignore transient local-server blips while files are being written.
      }
    }
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = 0;
    fingerprints.clear();
    showBadge(false);
  }

  function start() {
    stop();
    intervalMs = readInterval();
    showBadge(true);
    check();
    timer = window.setInterval(check, intervalMs);
  }

  function syncFromControls() {
    const enabled = checkbox ? checkbox.checked : readUrlDev();
    if (checkbox) setUrlDev(enabled);
    if (enabled) start();
    else stop();
  }

  if (checkbox) {
    if (readUrlDev()) checkbox.checked = true;
    checkbox.addEventListener("change", syncFromControls);
  }

  if (checkbox?.checked || readUrlDev()) syncFromControls();

  window.addEventListener("pagehide", stop);
})();
