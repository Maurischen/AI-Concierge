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

if (new URLSearchParams(window.location.search).get("embed") === "widget") {
  document.body.classList.add("widget-mode");
}

const catalogGrid = document.querySelector("#catalog-grid");
const messages = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#chat-input");
const cartCount = document.querySelector("#cart-count");
const salesEmail = document.body.dataset.salesEmail || "sales@example.com";

const loadingMessages = [
  "Doing the stock-room speedrun...",
  "Cross-checking specs like a tiny spreadsheet Jedi...",
  "Consulting the catalogue archives...",
  "Looking for the option that understood the assignment...",
  "Checking stock, specs, and the fine print...",
  "Separating the real matches from the side quests...",
  "Putting the product list through detective mode...",
  "Scanning the shelves at warp speed..."
];

const personalityTips = [
  "Tech tip: exact model numbers are the cheat codes for compatibility.",
  "Tiny wisdom: “at least 24-inch” and “exactly 24-inch” are very different quests.",
  "Upgrade lore: socket, connector, and form factor save everyone from drama.",
  "Brand preference unlocked: name the brand and I’ll favour it where stock allows.",
  "Store quest: ask for nearby stock once your live locations are connected.",
  "Compatibility mantra: measure twice, add to cart once.",
  "Cable chaos avoidance protocol: tell me HDMI, USB-C, Cat 6, 4K, 8K, or whatever matters.",
  "Boss fight shortcut: budget plus must-haves gets you better matches faster."
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

  const sourceNote =
    payload.source === "openai-agent"
      ? "GPT agent recommendation using live catalog tools."
      : payload.source === "openai"
        ? "AI-assisted recommendation."
        : "Local product matcher.";
  const mailSubject = encodeURIComponent("Compatibility quote request");
  const mailBody = encodeURIComponent(`Hi Sales Team,\n\nPlease help me confirm compatible options for:\n${originalText}\n\nExact model number:\n\nCurrent specs if known:\n\nThank you.`);
  const salesLink = payload.compatibilitySensitive
    ? `<p><a class="sales-link" href="mailto:${escapeHtml(salesEmail)}?subject=${mailSubject}&body=${mailBody}">Email sales with my exact model number</a></p>`
    : "";
  const webSources = (payload.webSources || [])
    .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>`)
    .join(" · ");
  addMessage(
    "ai",
    `<p>${escapeHtml(greetingPrefix())}${escapeHtml(payload.message)}</p><div class="recommendations">${cards}</div>${salesLink}<p>${escapeHtml(followUp)}</p><p class="source-note">${escapeHtml(sourceNote)}</p>${webSources ? `<p class="source-note">Compatibility sources: ${webSources}</p>` : ""}`
  );

  state.lastRecommendations = items;
  renderCatalog(items.map((product) => product.variantId));
}

function wantsComparison(text) {
  return /\b(compare|comparison|difference|differences|versus|vs\.?|which one|which is better|these two|between these)\b/i.test(text);
}

function compactDescription(product) {
  return [product.description, ...(product.specs || []), ...(product.tags || [])]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparisonHighlights(product) {
  const text = `${product.name} ${compactDescription(product)}`.toLowerCase();
  const highlights = [];

  if (/\bwireless\b/.test(text)) highlights.push("wireless");
  if (/\bbluetooth\b/.test(text)) highlights.push("Bluetooth");
  if (/\b2\.4\s?ghz\b/.test(text)) highlights.push("2.4GHz");
  if (/\baux\b|\b3\.5\s?mm\b/.test(text)) highlights.push("AUX/3.5mm");
  if (/\bnoise[- ]?cancel|noise cancel/i.test(text)) highlights.push("noise-cancel feature");
  if (/\brgb\b/.test(text)) highlights.push("RGB");
  if (/\brechargeable\b|\brechargable\b|\bbuilt[- ]?in battery\b/.test(text)) highlights.push("rechargeable");
  if (/\b7\.1\b|\bsurround\b/.test(text)) highlights.push("surround sound");
  if (/\blow latency\b/.test(text)) highlights.push("low latency");

  return highlights.length > 0 ? highlights.slice(0, 4).join(", ") : "core specs shown in product title";
}

function renderComparison(text) {
  const products = state.lastRecommendations.slice(0, 3);
  if (products.length < 2) {
    addMessage("ai", `<p>${escapeHtml(greetingPrefix())}I need at least two recent options to compare. Ask me for recommendations first, then I can line them up properly.</p>`);
    return true;
  }

  const cheapest = [...products].sort((a, b) => a.price - b.price)[0];
  const priciest = [...products].sort((a, b) => b.price - a.price)[0];
  const rows = products
    .map(
      (product, index) => `
        <article class="recommendation">
          <div class="recommendation-header">
            <div>
              <h3>${escapeHtml(product.name)}</h3>
              <strong>${money(product.price)}</strong>
            </div>
            <span class="fit-label">${index === 0 ? "Option 1" : `Option ${index + 1}`}</span>
          </div>
          <ul class="reason-list">
            <li>${escapeHtml(comparisonHighlights(product))}</li>
            <li>${escapeHtml(product.stock)} in stock.</li>
            <li>${product.price === cheapest.price ? "Best price." : product.price === priciest.price ? "Most expensive option." : "Middle-price option."}</li>
          </ul>
          <button type="button" data-add="${escapeHtml(product.variantId)}">Add to cart</button>
        </article>
      `
    )
    .join("");

  const pick = products.find((product) => /wireless|bluetooth|2\.4/i.test(`${product.name} ${compactDescription(product)}`)) || products[0];
  addMessage(
    "ai",
    `<p>${escapeHtml(greetingPrefix())}Here’s the clean comparison. Short version: pick <strong>${escapeHtml(pick.name)}</strong> if you want the strongest fit; pick <strong>${escapeHtml(cheapest.name)}</strong> if price matters most.</p><div class="recommendations">${rows}</div><p class="source-note">Comparison based on the most recent recommendation cards.</p>`
  );
  renderCatalog(products.map((product) => product.variantId));
  return true;
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

  if (wantsComparison(text) && renderComparison(text)) {
    state.conversation.push({ role: "user", content: text });
    state.conversation.push({ role: "assistant", content: "Compared the most recent recommendations." });
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
    addMessage("ai", `<p class="typing">${escapeHtml(greetingPrefix())}Preparing the Shopify cart handoff...</p>`);
    const payload = await api("/api/cart", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: 1, shop: state.shopDomain })
    });

    messages.querySelector(".typing")?.closest(".message")?.remove();
    state.cartCount = payload.count;
    cartCount.textContent = String(state.cartCount);

    if (payload.shopifyReady?.cartAddUrl) {
      addMessage(
        "ai",
        `<p><strong>${escapeHtml(payload.product.name)}</strong> is ready for your Shopify cart. Opening the cart now...</p><p><a href="${escapeHtml(payload.shopifyReady.cartAddUrl)}" target="_top" rel="noopener noreferrer">Open Shopify cart</a></p>`
      );
      window.setTimeout(() => {
        window.top.location.href = payload.shopifyReady.cartAddUrl;
      }, 600);
      return;
    }

    addMessage(
      "ai",
      `<p><strong>${escapeHtml(payload.product.name)}</strong> has been added to the demo cart.</p><p>Shopify-ready action: <code>${escapeHtml(payload.shopifyReady.mutation)}</code> with variant ID <code>${escapeHtml(payload.shopifyReady.merchandiseId)}</code>.</p>`
    );
  } catch (error) {
    messages.querySelector(".typing")?.closest(".message")?.remove();
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

function applyShopConfig(shop = {}) {
  const widgetConfig = shop.widgetConfig || {};
  const assistantName = shop.assistantName || "AI Concierge";
  const chatHeading = widgetConfig.chatHeading || assistantName;
  const chatSubheading = widgetConfig.chatSubheading || "Live guidance";

  document.querySelector(".chat-header h2").textContent = chatHeading;
  document.querySelector(".chat-header .eyebrow").textContent = chatSubheading;
  document.querySelector(".store-header h1").textContent = assistantName;

  if (shop.themeColor) {
    document.documentElement.style.setProperty("--accent", shop.themeColor);
  }
  if (widgetConfig.buttonHoverColor) {
    document.documentElement.style.setProperty("--accent-dark", widgetConfig.buttonHoverColor);
  }
  if (widgetConfig.buttonTextColor) {
    document.documentElement.style.setProperty("--button-text", widgetConfig.buttonTextColor);
  }
  if (shop.logoUrl) {
    const logoMarkup = `<img class="brand-logo" src="${escapeHtml(shop.logoUrl)}" alt="${escapeHtml(shop.storefrontName || assistantName || "Store logo")}" />`;
    document.querySelector(".store-header .eyebrow").insertAdjacentHTML("beforebegin", logoMarkup);
    document.querySelector(".chat-header .eyebrow").insertAdjacentHTML("beforebegin", logoMarkup);
  }
  if (shop.salesEmail) {
    document.body.dataset.salesEmail = shop.salesEmail;
  }
  if (widgetConfig.inputPlaceholder) {
    input.placeholder = widgetConfig.inputPlaceholder;
  }
  if (Array.isArray(widgetConfig.quickPrompts) && widgetConfig.quickPrompts.length > 0) {
    document.querySelector(".quick-prompts").innerHTML = widgetConfig.quickPrompts
      .slice(0, 3)
      .map((prompt) => `<button type="button" data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`)
      .join("");
  }
}

async function init() {
  const payload = await api("/api/products");
  applyShopConfig(payload.shop || {});
  state.products = payload.products;
  renderCatalog();
  addMessage(
    "ai",
    state.awaitingName
      ? `<p>${escapeHtml(payload.shop?.widgetConfig?.welcomeMessage || "Hi, I’m your AI Concierge. What should I call you while we shop?")}</p>`
      : `<p>Welcome back, ${escapeHtml(state.customerName)}. Tell me what you’re looking for, your budget, and any must-haves. I’ll recommend products from available stock and explain why they fit.</p>`
  );
}

init().catch((error) => {
  addMessage("ai", `<p>The concierge could not load products. ${escapeHtml(error.message)}</p>`);
});
