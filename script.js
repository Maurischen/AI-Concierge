const state = {
  shopDomain: new URLSearchParams(window.location.search).get("shop") || document.currentScript?.dataset.shop || "demo",
  products: [],
  cartCount: 0,
  lastRecommendations: [],
  conversation: [],
  customerLocation: null,
  shoppingIntent: null,
  customerName: sessionStorage.getItem("aiConciergeCustomerName") || "",
  awaitingName: !sessionStorage.getItem("aiConciergeCustomerName"),
  loadingMessageIndex: 0
};

const catalogGrid = document.querySelector("#catalog-grid");
const messages = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#chat-input");
const cartCount = document.querySelector("#cart-count");

const loadingMessages = [
  "Checking live stock and matching the details...",
  "Comparing options against your must-haves...",
  "Looking for the best fit in the current catalogue...",
  "Checking specs, stock, and compatibility...",
  "Scanning for close matches and avoiding the wrong kind of product..."
];

const personalityTips = [
  "Quick tip: exact model numbers help me avoid almost-right accessories.",
  "Quick tip: if size matters, tell me the exact size or say “at least” for larger options.",
  "Quick tip: for upgrades, tell me the socket, connector, or form factor when you know it.",
  "Quick tip: if you prefer a brand, name it and I’ll prioritise it where stock allows.",
  "Quick tip: you can ask for nearby store stock once locations are live."
];

const blockedLanguagePatterns = [
  /\bf+u+c+k+\b/i,
  /\bf+u+c+k+e+r+\b/i,
  /\bs+h+i+t+\b/i,
  /\bb+i+t+c+h+\b/i,
  /\bc+u+n+t+\b/i,
  /\ba+s+s+h+o+l+e+\b/i,
  /\bd+i+c+k+\b/i,
  /\bp+u+s+s+y+\b/i,
  /\bw+h+o+r+e+\b/i,
  /\bs+l+u+t+\b/i,
  /\bf+a+g+g+o+t+\b/i,
  /\br+e+t+a+r+d+\b/i,
  /\bk+a+f+f+i+r+\b/i,
  /\bk+a+f+e+r+\b/i,
  /\bk+a+f+f+e+r+\b/i,
  /\bn+i+g+g+(a|e)+r+\b/i,
  /\bh+o+t+n+o+t+\b/i,
  /\bc+o+o+l+i+e+\b/i,
  /\bm+o+f+f+i+e+\b/i,
  /\bp+o+e+s+\b/i,
  /\bp+o+e+p+o+l+\b/i,
  /\bd+o+o+s+\b/i,
  /\bf+o+k+\b/i,
  /\bf+o+k+o+f+\b/i,
  /\bf+o+k+\s*j+o+u+\b/i,
  /\bj+o+u+\s*m+a+\b/i,
  /\bv+o+e+t+s+e+k+\b/i,
  /\bk+a+k+\b/i,
  /\bg+a+a+n+\s*k+a+k+\b/i,
  /\bbliks+e+m+\b/i,
  /\bmoer\b/i,
  /\bmoer\s+jou\b/i,
  /\bp+i+e+l+\b/i,
  /\bt+i+e+t+\b/i,
  /\bt+i+e+t+s+\b/i,
  /\bs+k+a+n+k+\b/i,
  /\bh+o+e+r+\b/i
];

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "ZAR",
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

function containsBlockedLanguage(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[@$!]/g, (char) => ({ "@": "a", "$": "s", "!": "i" })[char] || char)
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = normalized.replace(/\s+/g, "");

  return blockedLanguagePatterns.some((pattern) => pattern.test(normalized) || pattern.test(compact));
}

function cleanNameCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z '-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNameFrom(text) {
  const raw = String(text || "").trim();
  const phraseMatch = raw.match(/\b(?:my name is|name is|i am|i'm|im|this is|call me)\s+([a-zA-Z][a-zA-Z '-]{1,40})/i);
  const cleaned = cleanNameCandidate(phraseMatch?.[1] || raw);
  const firstName = cleaned.split(" ")[0] || "";
  return firstName.length >= 2 ? firstName.slice(0, 30) : "";
}

function greetingPrefix() {
  return state.customerName ? `${state.customerName}, ` : "";
}

function nextLoadingMessage() {
  const message = loadingMessages[state.loadingMessageIndex % loadingMessages.length];
  const tip = personalityTips[state.loadingMessageIndex % personalityTips.length];
  state.loadingMessageIndex += 1;
  return `${greetingPrefix()}${message}<br><span class="source-note">${tip}</span>`;
}

async function api(path, options = {}) {
  const url = new URL(path, window.location.origin);
  if (!url.searchParams.has("shop")) {
    url.searchParams.set("shop", state.shopDomain);
  }

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options,
    body: options.body
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
    addMessage("ai", `<p>${escapeHtml(greetingPrefix())}${escapeHtml(payload.message)}</p>`);
    return;
  }

  const items = payload.recommendations?.length > 0 ? payload.recommendations : payload.suggestions || [];
  const cards = items
    .map((product, index) => {
      const label =
        payload.recommendations?.length > 0
          ? index === 0
            ? "Best fit"
            : index === 1
              ? "Alternative"
              : "Worth comparing"
          : index === 0
            ? "Possible match"
            : "Similar option";
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
    `<p>${escapeHtml(greetingPrefix())}${escapeHtml(payload.message)}</p><div class="recommendations">${cards}</div><p>${escapeHtml(followUp)}</p><p class="source-note">${escapeHtml(sourceNote)}</p>`
  );

  state.lastRecommendations = items;
  renderCatalog(items.map((product) => product.variantId));
}

function wantsNearbyStore(text) {
  return /\b(near me|nearest|closest|nearby|my location|closest store|nearest store)\b/i.test(text);
}

function getBrowserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        maximumAge: 10 * 60 * 1000,
        timeout: 8000
      }
    );
  });
}

async function handleCustomerNeed(text) {
  addMessage("user", `<p>${escapeHtml(text)}</p>`);

  if (containsBlockedLanguage(text)) {
    addMessage("ai", "<p>Let’s keep it respectful. I can help with product recommendations, but I won’t use abusive or vulgar wording as your name or shopping context.</p>");
    return;
  }

  if (state.awaitingName) {
    const name = firstNameFrom(text);
    if (name) {
      state.customerName = name;
      state.awaitingName = false;
      sessionStorage.setItem("aiConciergeCustomerName", name);
      addMessage(
        "ai",
        `<p>Great to meet you, ${escapeHtml(name)}. Tell me what you’re looking for, any must-haves, and whether you have a budget in mind.</p><p class="source-note">${escapeHtml(personalityTips[0])}</p>`
      );
    } else {
      addMessage("ai", "<p>What should I call you while we shop?</p>");
    }
    return;
  }

  state.conversation.push({ role: "user", content: text });
  addMessage("ai", `<p class="typing">${nextLoadingMessage()}</p>`);

  try {
    if (wantsNearbyStore(text) && !state.customerLocation) {
      state.customerLocation = await getBrowserLocation();
    }

    const payload = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message: text,
        shop: state.shopDomain,
        history: state.conversation.slice(-6),
        customerLocation: state.customerLocation,
        shoppingIntent: state.shoppingIntent
      })
    });

    messages.querySelector(".typing")?.closest(".message")?.remove();
    renderRecommendations(payload, text);
    if (payload.shoppingIntent) {
      state.shoppingIntent = payload.shoppingIntent;
    }
    if (payload.message) {
      state.conversation.push({ role: "assistant", content: payload.message });
    }
  } catch (error) {
    messages.querySelector(".typing")?.closest(".message")?.remove();
    addMessage("ai", `<p>I could not complete that request yet. ${escapeHtml(error.message)}</p>`);
  }
}

async function addToCart(variantId) {
  try {
    const payload = await api("/api/cart", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: 1, shop: state.shopDomain })
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
  if (payload.shop?.assistantName) {
    document.querySelector(".chat-header h2").textContent = payload.shop.assistantName;
  }
  if (payload.shop?.themeColor) {
    document.documentElement.style.setProperty("--accent", payload.shop.themeColor);
  }
  state.products = payload.products;
  renderCatalog();
  addMessage(
    "ai",
    state.awaitingName
      ? "<p>Hi, I’m your AI Concierge. What should I call you while we shop?</p>"
      : `<p>Welcome back, ${escapeHtml(state.customerName)}. Tell me what you’re looking for, your budget, and any must-haves. I’ll recommend products from available stock and explain why they fit.</p>`
  );
}

init().catch((error) => {
  addMessage("ai", `<p>The concierge could not load products. ${escapeHtml(error.message)}</p>`);
});
