const state = {
  products: [],
  cartCount: 0,
  lastRecommendations: []
};

const catalogGrid = document.querySelector("#catalog-grid");
const messages = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#chat-input");
const cartCount = document.querySelector("#cart-count");

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function renderCatalog(selectedIds = []) {
  catalogGrid.innerHTML = state.products
    .map((product) => {
      const selected = selectedIds.includes(product.variantId) ? " selected" : "";
      const image = product.imageUrl
        ? `<img class="product-photo" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" />`
        : `<div class="product-image" aria-hidden="true">${escapeHtml(product.badge)}</div>`;
      return `
        <article class="product-card${selected}">
          ${image}
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description)}</p>
          </div>
          <p>${product.specs.map(escapeHtml).join(" / ")}</p>
          <div class="product-meta">
            <span class="price">${money(product.price)}</span>
            <span class="stock">${product.stock} in stock</span>
          </div>
          <button type="button" data-add="${escapeHtml(product.variantId)}">Add to cart</button>
        </article>
      `;
    })
    .join("");
}

function addMessage(role, content) {
  const node = document.createElement("article");
  node.className = `message ${role}`;
  node.innerHTML = content;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function renderRecommendations(payload, originalText) {
  if (payload.type === "clarification") {
    addMessage("ai", `<p>${escapeHtml(payload.message)}</p>`);
    return;
  }

  const cards = payload.recommendations
    .map((product, index) => {
      const label = index === 0 ? "Best fit" : index === 1 ? "Alternative" : "Worth comparing";
      return `
        <article class="recommendation">
          <div class="recommendation-header">
            <div>
              <h3>${escapeHtml(product.name)}</h3>
              <strong>${money(product.price)}</strong>
            </div>
            <span class="fit-label">${label}</span>
          </div>
          <ul class="reason-list">
            ${product.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
          </ul>
          <button type="button" data-add="${escapeHtml(product.variantId)}">Add to cart</button>
        </article>
      `;
    })
    .join("");

  const followUp = originalText.toLowerCase().includes("compat")
    ? "For compatibility, I’d verify exact model numbers before checkout."
    : "You can ask me to compare these, narrow by budget, or build a complete setup.";

  const sourceNote = payload.source === "openai" ? "AI-assisted recommendation." : "Local product matcher.";
  addMessage(
    "ai",
    `<p>${escapeHtml(payload.message)}</p><div class="recommendations">${cards}</div><p>${escapeHtml(followUp)}</p><p class="source-note">${escapeHtml(sourceNote)}</p>`
  );

  state.lastRecommendations = payload.recommendations;
  renderCatalog(payload.recommendations.map((product) => product.variantId));
}

async function handleCustomerNeed(text) {
  addMessage("user", `<p>${escapeHtml(text)}</p>`);
  addMessage("ai", '<p class="typing">Checking current stock and fit...</p>');

  try {
    const payload = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: text })
    });

    messages.querySelector(".typing")?.closest(".message")?.remove();
    renderRecommendations(payload, text);
  } catch (error) {
    messages.querySelector(".typing")?.closest(".message")?.remove();
    addMessage("ai", `<p>I could not complete that request yet. ${escapeHtml(error.message)}</p>`);
  }
}

async function addToCart(variantId) {
  try {
    const payload = await api("/api/cart", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: 1 })
    });

    state.cartCount = payload.count;
    cartCount.textContent = String(state.cartCount);

    addMessage(
      "ai",
      `<p><strong>${escapeHtml(payload.product.name)}</strong> has been added to the demo cart.</p><p>Shopify-ready action: <code>${escapeHtml(payload.shopifyReady.mutation)}</code> with variant ID <code>${escapeHtml(payload.shopifyReady.merchandiseId)}</code>.</p>`
    );
  } catch (error) {
    addMessage("ai", `<p>I could not add that item to the cart. ${escapeHtml(error.message)}</p>`);
  }
}

catalogGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (button) addToCart(button.dataset.add);
});

messages.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (button) addToCart(button.dataset.add);
});

document.querySelector(".quick-prompts").addEventListener("click", (event) => {
  const button = event.target.closest("[data-prompt]");
  if (!button) return;
  input.value = button.dataset.prompt;
  input.focus();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  handleCustomerNeed(text);
});

async function init() {
  const payload = await api("/api/products");
  state.products = payload.products;
  renderCatalog();
  addMessage(
    "ai",
    "<p>Hi, I’m your AI Concierge. Tell me what you’re trying to do, your budget, and any must-haves. I’ll recommend products from available stock and explain why they fit.</p>"
  );
}

init().catch((error) => {
  addMessage("ai", `<p>The concierge could not load products. ${escapeHtml(error.message)}</p>`);
});
