(function () {
  const currentScript = document.currentScript;
  const shop = currentScript?.dataset.shop || window.Shopify?.shop || new URLSearchParams(window.location.search).get("shop") || "";
  const label = currentScript?.dataset.label || "AI Concierge";
  const origin = new URL(currentScript?.src || window.location.href).origin;
  const fallbackPosition = currentScript?.dataset.position || "bottom-right";
  const fallbackColor = currentScript?.dataset.themeColor || "#007a6a";

  if (document.querySelector("[data-ai-concierge-widget]")) return;

  const root = document.createElement("div");
  root.dataset.aiConciergeWidget = "true";
  root.innerHTML = `
    <button type="button" class="ai-concierge-button" aria-expanded="false">${label}</button>
    <section class="ai-concierge-panel" aria-label="${label}">
      <iframe title="${label}" src="${origin}/?shop=${encodeURIComponent(shop)}&embed=widget"></iframe>
    </section>
  `;

  const style = document.createElement("style");
  style.textContent = `
    [data-ai-concierge-widget] {
      position: fixed;
      bottom: 18px;
      z-index: 2147483000;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --ai-concierge-color: ${fallbackColor};
      --ai-concierge-width: 390px;
      --ai-concierge-height: 680px;
    }
    [data-ai-concierge-position="bottom-right"] {
      right: 18px;
    }
    [data-ai-concierge-position="bottom-left"] {
      left: 18px;
    }
    .ai-concierge-button {
      border: 0;
      border-radius: 999px;
      background: var(--ai-concierge-color);
      color: white;
      padding: 13px 16px;
      font-weight: 800;
      box-shadow: 0 14px 34px rgba(0,0,0,.22);
      cursor: pointer;
    }
    .ai-concierge-panel {
      display: none;
      position: absolute;
      bottom: 58px;
      width: min(var(--ai-concierge-width), calc(100vw - 28px));
      height: min(var(--ai-concierge-height), calc(100vh - 92px));
      border: 1px solid rgba(23,32,38,.18);
      border-radius: 12px;
      overflow: hidden;
      background: white;
      box-shadow: 0 24px 70px rgba(0,0,0,.28);
    }
    [data-ai-concierge-position="bottom-right"] .ai-concierge-panel {
      right: 0;
    }
    [data-ai-concierge-position="bottom-left"] .ai-concierge-panel {
      left: 0;
    }
    .ai-concierge-panel iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
    [data-ai-concierge-widget].open .ai-concierge-panel {
      display: block;
    }
    @media (max-width: 520px) {
      [data-ai-concierge-widget] {
        right: 12px;
        bottom: 12px;
      }
      .ai-concierge-panel {
        position: fixed;
        inset: 12px;
        width: auto;
        height: auto;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(root);
  root.dataset.aiConciergePosition = fallbackPosition;

  const button = root.querySelector(".ai-concierge-button");
  button.addEventListener("click", () => {
    const open = root.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
  });

  fetch(`${origin}/api/shop-config?shop=${encodeURIComponent(shop)}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const shopConfig = payload?.shop || {};
      const widgetConfig = shopConfig.widgetConfig || {};
      const nextLabel = widgetConfig.launcherLabel || label;
      const position = widgetConfig.launcherPosition || fallbackPosition;
      const color = shopConfig.themeColor || fallbackColor;
      button.textContent = nextLabel;
      root.querySelector(".ai-concierge-panel").setAttribute("aria-label", nextLabel);
      root.querySelector("iframe").title = nextLabel;
      root.dataset.aiConciergePosition = position;
      root.style.setProperty("--ai-concierge-color", color);
      root.style.setProperty("--ai-concierge-width", `${widgetConfig.panelWidth || 390}px`);
      root.style.setProperty("--ai-concierge-height", `${widgetConfig.panelHeight || 680}px`);
    })
    .catch(() => {});
})();
