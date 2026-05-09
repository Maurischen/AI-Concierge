const form = document.querySelector("#admin-form");
const statusNode = document.querySelector("#admin-status");
const shopInput = document.querySelector("#shop-domain");
const tokenInput = document.querySelector("#admin-token");
const snippetNode = document.querySelector("#widget-snippet");

const params = new URLSearchParams(window.location.search);
shopInput.value = params.get("shop") || localStorage.getItem("aiConciergeAdminShop") || "";
tokenInput.value = params.get("token") || localStorage.getItem("aiConciergeAdminToken") || "";

function setStatus(message) {
  statusNode.textContent = message;
}

function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Admin-Token": tokenInput.value.trim()
  };
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

function fillForm(shop) {
  form.storefrontName.value = shop?.storefrontName || "";
  form.assistantName.value = shop?.assistantName || "AI Concierge";
  form.logoUrl.value = shop?.logoUrl || "";
  form.themeColor.value = shop?.themeColor || "#007a6a";
  form.salesEmail.value = shop?.salesEmail || "";
  form.supportEmail.value = shop?.supportEmail || "";
  form.marketType.value = shop?.marketType || "";
  form.preferredBrands.value = JSON.stringify(shop?.preferredBrands || {}, null, 2);
  renderSnippet();
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

  const response = await fetch(`/api/admin/shop?${shopQuery()}`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      storefrontName: form.storefrontName.value.trim(),
      assistantName: form.assistantName.value.trim(),
      logoUrl: form.logoUrl.value.trim(),
      themeColor: form.themeColor.value,
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
form.addEventListener("submit", (event) => saveShop(event).catch((error) => setStatus(error.message)));
shopInput.addEventListener("input", renderSnippet);

renderSnippet();
if (shopInput.value) {
  loadShop().catch((error) => setStatus(error.message));
}
