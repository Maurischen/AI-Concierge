const form = document.querySelector("#admin-form");
const statusNode = document.querySelector("#admin-status");
const shopInput = document.querySelector("#shop-domain");
const tokenInput = document.querySelector("#admin-token");
const snippetNode = document.querySelector("#widget-snippet");
const authNote = document.querySelector("#admin-auth-note");
const filePicker = document.querySelector("#file-picker");
const logoPreview = document.querySelector("#logo-preview");
const loadFilesButton = document.querySelector("#load-files");

const params = new URLSearchParams(window.location.search);
const signedAdminQuery = window.location.search.replace(/^\?/, "");
const hasShopifyAdminAuth = params.has("hmac") && params.has("shop");

shopInput.value = params.get("shop") || localStorage.getItem("aiConciergeAdminShop") || "";
tokenInput.value = params.get("token") || localStorage.getItem("aiConciergeAdminToken") || "";
if (hasShopifyAdminAuth) {
  authNote.textContent = "Authenticated through Shopify Admin.";
  tokenInput.closest("label").hidden = true;
}

function setStatus(message) {
  statusNode.textContent = message;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeHexColour(value, fallback = "") {
  const raw = String(value || "").trim().toLowerCase();
  const match = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return fallback;
  const hex = match[1].toLowerCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

function syncThemeColour(value = "#007a6a") {
  const normalized = normalizeHexColour(value, "#007a6a");
  form.themeColor.value = normalized;
  form.themeColorHex.value = normalized;
  return normalized;
}

function adminHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "X-Admin-Token": tokenInput.value.trim()
  };
  if (signedAdminQuery) headers["X-Shopify-Admin-Query"] = signedAdminQuery;
  return headers;
}

function shopQuery() {
  const shop = shopInput.value.trim();
  return `shop=${encodeURIComponent(shop)}`;
}

function widgetSnippet(shop) {
  return `<script src="${window.location.origin}/widget.js" data-shop="${shop}" async></script>`;
}

function renderSnippet() {
  snippetNode.textContent = widgetSnippet(shopInput.value.trim() || "your-store.myshopify.com");
}

function renderLogoPreview() {
  const logoUrl = form.logoUrl.value.trim();
  logoPreview.innerHTML = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Selected logo" />` : "<span>No logo selected</span>";
}

function fillForm(shop) {
  form.storefrontName.value = shop?.storefrontName || "";
  form.assistantName.value = shop?.assistantName || "AI Concierge";
  form.logoUrl.value = shop?.logoUrl || "";
  syncThemeColour(shop?.themeColor || "#007a6a");
  form.salesEmail.value = shop?.salesEmail || "";
  form.supportEmail.value = shop?.supportEmail || "";
  form.marketType.value = shop?.marketType || "";
  form.preferredBrands.value = JSON.stringify(shop?.preferredBrands || {}, null, 2);
  renderSnippet();
  renderLogoPreview();
}

async function loadShop() {
  if (!shopInput.value.trim()) {
    setStatus("Enter a shop domain first.");
    return;
  }

  localStorage.setItem("aiConciergeAdminShop", shopInput.value.trim());
  localStorage.setItem("aiConciergeAdminToken", tokenInput.value.trim());
  setStatus("Loading...");

  const response = await fetch(`/api/admin/shop?${shopQuery()}`, {
    headers: adminHeaders()
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not load settings.");

  fillForm(payload.shop);
  setStatus("Settings loaded.");
}

function renderFiles(files) {
  if (!files.length) {
    filePicker.innerHTML = "<p>No Shopify image files found yet.</p>";
    return;
  }

  filePicker.innerHTML = files
    .map(
      (file) => `
        <button type="button" class="file-option" data-url="${escapeHtml(file.url)}">
          <img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.alt || "Shopify file")}" />
          <span>${escapeHtml(file.alt || file.url.split("/").pop().split("?")[0])}</span>
        </button>
      `
    )
    .join("");
}

async function loadShopifyFiles() {
  if (!shopInput.value.trim()) {
    setStatus("Enter a shop domain first.");
    return;
  }

  setStatus("Loading Shopify files...");
  const response = await fetch(`/api/admin/files?${shopQuery()}`, {
    headers: adminHeaders()
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not load Shopify files.");

  renderFiles(payload.files || []);
  setStatus("Choose a logo from Shopify files.");
}

async function saveShop(event) {
  event.preventDefault();
  localStorage.setItem("aiConciergeAdminShop", shopInput.value.trim());
  localStorage.setItem("aiConciergeAdminToken", tokenInput.value.trim());
  setStatus("Saving...");

  let preferredBrands = {};
  try {
    preferredBrands = JSON.parse(form.preferredBrands.value || "{}");
  } catch {
    setStatus("Preferred brands must be valid JSON.");
    return;
  }
  const normalizedThemeColor = normalizeHexColour(form.themeColorHex.value);
  if (!normalizedThemeColor) {
    setStatus("Theme colour must be a valid hex code like #007a6a.");
    return;
  }
  syncThemeColour(normalizedThemeColor);

  const response = await fetch(`/api/admin/shop?${shopQuery()}`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      storefrontName: form.storefrontName.value.trim(),
      assistantName: form.assistantName.value.trim(),
      logoUrl: form.logoUrl.value.trim(),
      themeColor: normalizedThemeColor,
      salesEmail: form.salesEmail.value.trim(),
      supportEmail: form.supportEmail.value.trim(),
      marketType: form.marketType.value.trim(),
      preferredBrands
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not save settings.");

  fillForm(payload.shop);
  setStatus("Saved.");
}

document.querySelector("#load-shop").addEventListener("click", () => loadShop().catch((error) => setStatus(error.message)));
loadFilesButton.addEventListener("click", () => loadShopifyFiles().catch((error) => setStatus(error.message)));
filePicker.addEventListener("click", (event) => {
  const option = event.target.closest(".file-option");
  if (!option) return;
  form.logoUrl.value = option.dataset.url;
  renderLogoPreview();
  setStatus("Logo selected. Save settings to apply it.");
});
form.addEventListener("submit", (event) => saveShop(event).catch((error) => setStatus(error.message)));
shopInput.addEventListener("input", renderSnippet);
form.logoUrl.addEventListener("input", renderLogoPreview);
form.themeColor.addEventListener("input", () => {
  form.themeColorHex.value = form.themeColor.value.toLowerCase();
});
form.themeColorHex.addEventListener("input", () => {
  const normalized = normalizeHexColour(form.themeColorHex.value);
  if (normalized) form.themeColor.value = normalized;
});
form.themeColorHex.addEventListener("blur", () => {
  const normalized = normalizeHexColour(form.themeColorHex.value);
  if (normalized) syncThemeColour(normalized);
});

renderSnippet();
renderLogoPreview();
syncThemeColour(form.themeColor.value);
if (shopInput.value) {
  loadShop().catch((error) => setStatus(error.message));
}
