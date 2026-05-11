const form = document.querySelector("#admin-form");
const statusNode = document.querySelector("#admin-status");
const shopInput = document.querySelector("#shop-domain");
const authNote = document.querySelector("#admin-auth-note");
const filePicker = document.querySelector("#file-picker");
const logoPreview = document.querySelector("#logo-preview");
const loadFilesButton = document.querySelector("#load-files");
const brandRules = document.querySelector("#brand-rules");
const addBrandRuleButton = document.querySelector("#add-brand-rule");

const params = new URLSearchParams(window.location.search);
const adminSession = window.AI_CONCIERGE_ADMIN_SESSION || null;
const signedAdminQuery = window.location.search.replace(/^\?/, "");
const hasShopifyAdminAuth = params.has("hmac") && params.has("shop");

shopInput.value = params.get("shop") || adminSession?.shop || localStorage.getItem("aiConciergeAdminShop") || "";
if (hasShopifyAdminAuth || adminSession?.authenticated || adminSession?.token) {
  authNote.textContent = "Authenticated through Shopify Admin.";
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

function syncColour(pickerName, hexName, value, fallback) {
  const normalized = normalizeHexColour(value, fallback);
  form[pickerName].value = normalized;
  form[hexName].value = normalized;
  return normalized;
}

function syncThemeColour(value = "#007a6a") {
  return syncColour("themeColor", "themeColorHex", value, "#007a6a");
}

function syncButtonHoverColour(value = "#005f53") {
  return syncColour("buttonHoverColor", "buttonHoverColorHex", value, "#005f53");
}

function syncButtonTextColour(value = "#ffffff") {
  return syncColour("buttonTextColor", "buttonTextColorHex", value, "#ffffff");
}

function defaultWidgetConfig() {
  return {
    launcherLabel: "AI Concierge",
    launcherPosition: "bottom-right",
    panelWidth: 390,
    panelHeight: 680,
    chatHeading: "Find the right gear",
    chatSubheading: "Live guidance",
    welcomeMessage: "Hi, I’m your AI Concierge. What should I call you while we shop?",
    inputPlaceholder: "Tell me what you need, your budget, and how you'll use it...",
    buttonHoverColor: "#005f53",
    buttonTextColor: "#ffffff",
    quickPrompts: ["Gaming + design", "Home office", "Accessories"]
  };
}

function addBrandRuleRow(category = "", brands = []) {
  const row = document.createElement("div");
  row.className = "brand-rule";
  row.innerHTML = `
    <label>
      Product category
      <input data-brand-category placeholder="cable, monitor, bag..." value="${escapeHtml(category)}" />
    </label>
    <label>
      Preferred brands
      <input data-brand-list placeholder="UGreen, AOC, Surge" value="${escapeHtml(Array.isArray(brands) ? brands.join(", ") : brands)}" />
    </label>
    <button type="button" data-remove-brand-rule>Remove</button>
  `;
  brandRules.appendChild(row);
}

function renderBrandRules(preferredBrands = {}) {
  brandRules.innerHTML = "";
  const entries = Object.entries(preferredBrands || {});
  if (entries.length === 0) {
    addBrandRuleRow("", []);
    return;
  }
  for (const [category, brands] of entries) addBrandRuleRow(category, brands);
}

function collectBrandRules() {
  const rules = {};
  for (const row of brandRules.querySelectorAll(".brand-rule")) {
    const category = row.querySelector("[data-brand-category]").value.trim().toLowerCase();
    const brands = row
      .querySelector("[data-brand-list]")
      .value.split(",")
      .map((brand) => brand.trim())
      .filter(Boolean);
    if (category && brands.length > 0) rules[category] = brands;
  }
  return rules;
}

function adminHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };
  if (signedAdminQuery) headers["X-Shopify-Admin-Query"] = signedAdminQuery;
  if (adminSession?.token) headers["X-AI-Concierge-Admin-Token"] = adminSession.token;
  console.info("[AI Concierge Admin] auth headers ready", {
    hasSignedShopifyQuery: Boolean(signedAdminQuery),
    hasInjectedAdminToken: Boolean(adminSession?.token)
  });
  return headers;
}

function shopQuery() {
  const shop = shopInput.value.trim();
  return `shop=${encodeURIComponent(shop)}`;
}

function renderLogoPreview() {
  const logoUrl = form.logoUrl.value.trim();
  logoPreview.innerHTML = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Selected logo" />` : "<span>No logo selected</span>";
}

function fillForm(shop) {
  const widgetConfig = { ...defaultWidgetConfig(), ...(shop?.widgetConfig || {}) };
  form.storefrontName.value = shop?.storefrontName || "";
  form.assistantName.value = shop?.assistantName || "AI Concierge";
  form.logoUrl.value = shop?.logoUrl || "";
  syncThemeColour(shop?.themeColor || "#007a6a");
  syncButtonHoverColour(widgetConfig.buttonHoverColor || "#005f53");
  syncButtonTextColour(widgetConfig.buttonTextColor || "#ffffff");
  form.launcherLabel.value = widgetConfig.launcherLabel;
  form.launcherPosition.value = widgetConfig.launcherPosition;
  form.panelWidth.value = widgetConfig.panelWidth;
  form.panelHeight.value = widgetConfig.panelHeight;
  form.chatHeading.value = widgetConfig.chatHeading;
  form.chatSubheading.value = widgetConfig.chatSubheading;
  form.welcomeMessage.value = widgetConfig.welcomeMessage;
  form.inputPlaceholder.value = widgetConfig.inputPlaceholder;
  form.quickPrompt1.value = widgetConfig.quickPrompts?.[0] || "";
  form.quickPrompt2.value = widgetConfig.quickPrompts?.[1] || "";
  form.quickPrompt3.value = widgetConfig.quickPrompts?.[2] || "";
  form.salesEmail.value = shop?.salesEmail || "";
  form.supportEmail.value = shop?.supportEmail || "";
  form.marketType.value = shop?.marketType || "";
  form.preferredBrands.value = JSON.stringify(shop?.preferredBrands || {}, null, 2);
  renderBrandRules(shop?.preferredBrands || {});
  renderLogoPreview();
}

async function loadShop() {
  if (!shopInput.value.trim()) {
    setStatus("Enter a shop domain first.");
    return;
  }

  localStorage.setItem("aiConciergeAdminShop", shopInput.value.trim());
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
  console.info("[AI Concierge Admin] Choose from Shopify files clicked", {
    shop: shopInput.value.trim(),
    hasInjectedAdminToken: Boolean(adminSession?.token)
  });

  if (!shopInput.value.trim()) {
    setStatus("Enter a shop domain first.");
    return;
  }

  setStatus("Loading Shopify files...");
  console.info("[AI Concierge Admin] Requesting Shopify files through Admin API browser fallback");
  const response = await fetch(`/api/admin/files?${shopQuery()}`, {
    headers: adminHeaders()
  });
  console.info("[AI Concierge Admin] Shopify files response", {
    ok: response.ok,
    status: response.status
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not load Shopify files.");

  renderFiles(payload.files || []);
  setStatus("Choose a logo from Shopify files.");
}

async function saveShop(event) {
  event.preventDefault();
  localStorage.setItem("aiConciergeAdminShop", shopInput.value.trim());
  setStatus("Saving...");

  let preferredBrands = collectBrandRules();
  form.preferredBrands.value = JSON.stringify(preferredBrands, null, 2);
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
  const normalizedButtonHoverColor = normalizeHexColour(form.buttonHoverColorHex.value);
  if (!normalizedButtonHoverColor) {
    setStatus("Button hover colour must be a valid hex code like #005f53.");
    return;
  }
  const normalizedButtonTextColor = normalizeHexColour(form.buttonTextColorHex.value);
  if (!normalizedButtonTextColor) {
    setStatus("Button text colour must be a valid hex code like #ffffff.");
    return;
  }
  syncThemeColour(normalizedThemeColor);
  syncButtonHoverColour(normalizedButtonHoverColor);
  syncButtonTextColour(normalizedButtonTextColor);

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
      widgetConfig: {
        launcherLabel: form.launcherLabel.value.trim(),
        launcherPosition: form.launcherPosition.value,
        panelWidth: Number(form.panelWidth.value || 390),
        panelHeight: Number(form.panelHeight.value || 680),
        chatHeading: form.chatHeading.value.trim(),
        chatSubheading: form.chatSubheading.value.trim(),
        welcomeMessage: form.welcomeMessage.value.trim(),
        inputPlaceholder: form.inputPlaceholder.value.trim(),
        buttonHoverColor: normalizedButtonHoverColor,
        buttonTextColor: normalizedButtonTextColor,
        quickPrompts: [form.quickPrompt1.value, form.quickPrompt2.value, form.quickPrompt3.value].map((prompt) => prompt.trim()).filter(Boolean)
      },
      preferredBrands
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not save settings.");

  fillForm(payload.shop);
  setStatus("Saved.");
}

document.querySelector("#load-shop").addEventListener("click", () => loadShop().catch((error) => setStatus(error.message)));
addBrandRuleButton.addEventListener("click", () => addBrandRuleRow("", []));
brandRules.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-brand-rule]");
  if (!button) return;
  button.closest(".brand-rule").remove();
  if (!brandRules.querySelector(".brand-rule")) addBrandRuleRow("", []);
});
loadFilesButton.addEventListener("click", (event) => {
  event.preventDefault();
  console.info("[AI Concierge Admin] File selector button handler fired");
  loadShopifyFiles().catch((error) => {
    console.error("[AI Concierge Admin] Shopify file browser failed", error);
    setStatus(error.message);
  });
});
filePicker.addEventListener("click", (event) => {
  const option = event.target.closest(".file-option");
  if (!option) return;
  form.logoUrl.value = option.dataset.url;
  renderLogoPreview();
  setStatus("Logo selected. Save settings to apply it.");
});
form.addEventListener("submit", (event) => saveShop(event).catch((error) => setStatus(error.message)));
form.logoUrl.addEventListener("input", renderLogoPreview);
form.preferredBrands.addEventListener("blur", () => {
  try {
    renderBrandRules(JSON.parse(form.preferredBrands.value || "{}"));
    setStatus("Brand rules updated from JSON.");
  } catch {
    setStatus("Preferred brands JSON is not valid.");
  }
});
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
form.buttonHoverColor.addEventListener("input", () => {
  form.buttonHoverColorHex.value = form.buttonHoverColor.value.toLowerCase();
});
form.buttonHoverColorHex.addEventListener("input", () => {
  const normalized = normalizeHexColour(form.buttonHoverColorHex.value);
  if (normalized) form.buttonHoverColor.value = normalized;
});
form.buttonHoverColorHex.addEventListener("blur", () => {
  const normalized = normalizeHexColour(form.buttonHoverColorHex.value);
  if (normalized) syncButtonHoverColour(normalized);
});
form.buttonTextColor.addEventListener("input", () => {
  form.buttonTextColorHex.value = form.buttonTextColor.value.toLowerCase();
});
form.buttonTextColorHex.addEventListener("input", () => {
  const normalized = normalizeHexColour(form.buttonTextColorHex.value);
  if (normalized) form.buttonTextColor.value = normalized;
});
form.buttonTextColorHex.addEventListener("blur", () => {
  const normalized = normalizeHexColour(form.buttonTextColorHex.value);
  if (normalized) syncButtonTextColour(normalized);
});

renderLogoPreview();
syncThemeColour(form.themeColor.value);
syncButtonHoverColour(form.buttonHoverColor.value);
syncButtonTextColour(form.buttonTextColor.value);
if (shopInput.value) {
  loadShop().catch((error) => setStatus(error.message));
}
