(function () {
  const currentScript = document.currentScript;
  const shop = currentScript?.dataset.shop || window.Shopify?.shop || new URLSearchParams(window.location.search).get("shop") || "";
  const label = currentScript?.dataset.label || "AI Concierge";
  const origin = new URL(currentScript?.src || window.location.href).origin;

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
      right: 18px;
      bottom: 18px;
      z-index: 2147483000;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .ai-concierge-button {
      border: 0;
      border-radius: 999px;
      background: #007a6a;
      color: white;
      padding: 13px 16px;
      font-weight: 800;
      box-shadow: 0 14px 34px rgba(0,0,0,.22);
      cursor: pointer;
    }
    .ai-concierge-panel {
      display: none;
      position: absolute;
      right: 0;
      bottom: 58px;
      width: min(390px, calc(100vw - 28px));
      height: min(680px, calc(100vh - 92px));
      border: 1px solid rgba(23,32,38,.18);
      border-radius: 12px;
      overflow: hidden;
      background: white;
      box-shadow: 0 24px 70px rgba(0,0,0,.28);
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

  const button = root.querySelector(".ai-concierge-button");
  button.addEventListener("click", () => {
    const open = root.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
  });
})();
