import crypto from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getShop,
  listShops,
  loadCatalog,
  normalizeShopDomain,
  removeCatalogProduct,
  updateInventoryLevel,
  upsertShop,
  upsertCatalogProduct
} from "./lib/catalog-store.js";
import { applyCompatibilityContext } from "./lib/compatibility.js";
import { applyLocationContext } from "./lib/locations.js";
import { rankRecommendationsWithOpenAI, researchCompatibilityWithWeb } from "./lib/openai.js";
import { getQualificationQuestions, isRelevantProductForRequest, needsClarification, recommendProducts, suggestSimilarProducts } from "./lib/recommendations.js";
import { productMatchesRequestedIntents, requestedIntentNames } from "./lib/product-intents.js";
import { normalizeWebhookProduct, shopifyGraphql, verifyShopifyWebhook } from "./lib/shopify.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5174);
const host = process.env.RENDER ? "0.0.0.0" : "127.0.0.1";
const demoCart = [];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const productTypePattern =
  /\b(cable|charger|power bank|powerbank|psu|power supply|power-supply|monitor|screen|display|ram|memory|ssd|hdd|hard drive|flash drive|usb drive|laptop|desktop|keyboard|mouse|steering wheel|racing wheel|wheel|router|switch|printer|toner|ink|cartridge|webcam|headset|speaker|microphone|motherboard|cpu|processor|graphics card|gpu|bag|backpack)\b/i;

const motherboardRequirementPattern = /\b(slots?|sticks?|dimms?|memory slots?|ram slots?|upgrade|eventually|support|supports?|up to|max(?:imum)?)\b/i;

function normalizeIntentText(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

function extractProductType(text) {
  const raw = String(text || "").toLowerCase();
  if (/\b(upgrade|replace|add|more|compatible|work with|for)\b.*\b(ram|memory)\b|\b(ram|memory)\b.*\b(for|compatible|work with|upgrade)\b/.test(raw)) {
    return "ram";
  }
  if (/\b(upgrade|replace|add|more|compatible|work with|for)\b.*\b(ssd|hdd|hard drive|storage)\b|\b(ssd|hdd|hard drive|storage)\b.*\b(for|compatible|work with|upgrade)\b/.test(raw)) {
    return raw.includes("hdd") || raw.includes("hard drive") ? "hdd" : "ssd";
  }
  const match = normalizeIntentText(text).match(productTypePattern);
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (["ram", "memory"].includes(type) && /\bmotherboard|mainboard|board\b/.test(raw)) return "motherboard";
  if (["screen", "display"].includes(type)) return "monitor";
  if (["powerbank"].includes(type)) return "power bank";
  if (["power supply", "power-supply"].includes(type)) return "psu";
  if (["memory"].includes(type)) return "ram";
  if (["hard drive"].includes(type)) return "hdd";
  if (["usb drive"].includes(type)) return "flash drive";
  if (["ink"].includes(type)) return "cartridge";
  if (["toner"].includes(type)) return "cartridge";
  if (["processor"].includes(type)) return "cpu";
  if (["gpu"].includes(type)) return "graphics card";
  if (["backpack"].includes(type)) return "bag";
  if (["racing wheel", "wheel"].includes(type)) return "steering wheel";
  return type;
}

function extractBudget(text) {
  const terms = String(text).toLowerCase().replace(/(\d)\s+(\d{3})/g, "$1$2");
  const match = terms.match(/\b(?:under|below|less than|budget|around|about|range|up to)?\s*(?:r|zar|rand)?\s?(\d{2,6})\b/);
  return match ? match[1] : null;
}

function extractModelTokens(text) {
  const terms = String(text || "").toLowerCase().replace(/(\d)\s+(\d{3})/g, "$1$2");
  return [
    ...new Set(
      terms
        .match(/\b[a-z]{1,6}\d{2,6}[a-z0-9-]*\b|\b\d{3,6}[a-z]?\b/g)
        ?.filter((token) => {
          const nearby = terms.slice(Math.max(0, terms.indexOf(token) - 14), terms.indexOf(token) + token.length + 14);
          return !/\b(rand|zar|budget|under|below|around|about|mah|gb|tb|w)\b/.test(nearby);
        }) || []
    )
  ];
}

function extractDeviceModelPhrase(text) {
  const raw = normalizeIntentText(text);
  const match =
    raw.match(/\b(?:i have|for my|for a|for an|compatible with|work with|works with)\s+(?:an?\s+)?([a-z0-9][a-z0-9 -]{2,60}?)(?:\s+(?:laptop|notebook|desktop|pc|motherboard|board|graphics card|gpu|card)\b|\s+and\b|,|$)/i) ||
    raw.match(/\b([a-z]{2,}\s+[a-z0-9-]*\d{2,}[a-z0-9-]*(?:\s+[a-z0-9-]+)?)\b/i);
  return match?.[1]?.trim() || "";
}

function budgetIsOpen(text) {
  return /\b(i don'?t have a budget|i don'?t know|not sure|no budget|without a budget|any budget|show me|what is available|what'?s available|what is in stock|what'?s in stock|available stock|upgrade|compatible|work with|works with|for my|i have)\b/i.test(
    text
  );
}

function extractIntentSpecs(text) {
  const terms = String(text).toLowerCase();
  const specs = [];
  const patterns = [
    /\b(cat\s?5e?|cat\s?6a?|cat\s?6|cat\s?7|cat\s?8)\b/g,
    /\b(8k|4k|uhd|qhd|fhd|1080p|1440p)\b/g,
    /\b(hdmi|vga|displayport|dp|usb[- ]?c|type[- ]?c|lightning|ethernet|lan)\b/g,
    /\b(wireless|rechargeable|rechargable|chargeable|bluetooth|2\.4\s?ghz)\b/g,
    /\b(nvme|sata|m\.?2|2\.5|3\.5|ddr4|ddr5|am4|am5|lga\s?\d+|skt\s?\d+|socket\s?\d+|atx|m-atx|matx|itx)\b/g,
    /\b(\d{3,4}\s?w)\b/g
  ];

  for (const pattern of patterns) {
    for (const match of terms.matchAll(pattern)) specs.push(match[1].replace(/\s+/g, " "));
  }

  return [
    ...new Set(
      specs.map((spec) => {
        const socket = spec.match(/^(skt|socket)\s?(\d+)$/i);
        return socket ? `lga${socket[2]}` : spec;
      })
    )
  ];
}

function extractSizes(text) {
  const terms = String(text).toLowerCase();
  return [...terms.matchAll(/\b(\d+(\.\d+)?)\s?(\"|”|'|inch|inches|in|tb|gb|mah|m)\b/g)].map((match) => match[0]);
}

function extractBrandsFromText(text) {
  const terms = normalizeIntentText(text);
  const preferenceSegment = terms.match(/\b(?:prefer|preferred|preference|brand|brands|only)\b(.{0,100})/i)?.[1] || "";
  if (!preferenceSegment) return [];
  return [
    ...new Set(
      preferenceSegment
        .replace(/\b(brand|brands|make|makes|vendor|vendors|would|like|a|an|the|or|and)\b/gi, " ")
        .split(/[,/]/)
        .flatMap((part) => part.trim().split(/\s{2,}/))
        .map((brand) => brand.trim())
        .filter((brand) => /^[a-z0-9][a-z0-9 -]{1,34}$/i.test(brand))
    )
  ];
}

function updateShoppingIntent(previousIntent, message) {
  const latest = normalizeIntentText(message);
  let latestProductType = extractProductType(latest);
  if (previousIntent?.productType === "motherboard" && latestProductType === "ram" && motherboardRequirementPattern.test(latest)) {
    latestProductType = "motherboard";
  }
  const productTypeChanged = latestProductType && previousIntent?.productType && latestProductType !== previousIntent.productType;
  const baseIntent = productTypeChanged ? null : previousIntent;
  const productType = latestProductType || baseIntent?.productType || null;
  const latestSpecs = extractIntentSpecs(latest);
  const specs = latestProductType === "ram" && baseIntent?.specs?.some((spec) => /^ddr[45]$/i.test(spec)) && !latestSpecs.some((spec) => /^ddr[45]$/i.test(spec))
    ? [...baseIntent.specs, ...latestSpecs]
    : latestSpecs;
  const sizes = extractSizes(latest);
  const modelTokens = extractModelTokens(latest);
  const deviceModel = extractDeviceModelPhrase(latest) || baseIntent?.deviceModel || "";
  const deviceKind =
    latest.match(/\b(laptop|notebook|desktop|pc|motherboard|mainboard|graphics card|gpu)\b/i)?.[1]?.toLowerCase() ||
    baseIntent?.deviceKind ||
    "";
  const brands = extractBrandsFromText(latest);
  const budget = extractBudget(latest) || baseIntent?.budget || null;
  const openBudget = budgetIsOpen(latest) || (!budget && baseIntent?.openBudget === true);
  const replacesSpecs = /\b(instead|rather|change|changed|different|other|now|actually)\b/i.test(latest);

  return {
    productType,
    budget,
    openBudget,
    specs: specs.length > 0 ? specs : replacesSpecs ? [] : baseIntent?.specs || [],
    sizes: sizes.length > 0 ? sizes : replacesSpecs ? [] : baseIntent?.sizes || [],
    modelTokens: modelTokens.length > 0 ? modelTokens : replacesSpecs ? [] : baseIntent?.modelTokens || [],
    deviceModel,
    deviceKind,
    brands: brands.length > 0 ? brands : baseIntent?.brands || []
  };
}

function isCompatibilityUpgradeIntent(intent, text) {
  const terms = String(text || "").toLowerCase();
  const modelTokens = (intent?.modelTokens || []).filter((token) => /[a-z]+\d|\d+[a-z]/i.test(token));
  const deviceModel = String(intent?.deviceModel || "");
  const hasDeviceModelCode = /\b[a-z][a-z0-9-]*\s+[a-z0-9-]*\d{2,}[a-z0-9-]*(?:\s+[a-z0-9-]+)?\b/i.test(deviceModel);
  const hasGpuModelCode = /\b(rtx|gtx|rx)\s?-?\s?\d{3,4}\b/i.test(terms);

  return Boolean(
    /\b(compatible|work with|works with|for my|i have|existing|exact model|upgrade)\b/i.test(terms) &&
      (modelTokens.length > 0 || hasDeviceModelCode || hasGpuModelCode)
  );
}

function shoppingIntentToText(intent) {
  if (!intent?.productType) return "";
  return [
    intent.sizes?.join(" "),
    intent.deviceModel ? `for ${intent.deviceModel}${intent.deviceKind ? ` ${intent.deviceKind}` : ""}` : intent.deviceKind ? `for ${intent.deviceKind}` : null,
    intent.modelTokens?.join(" "),
    intent.specs?.join(" "),
    intent.productType,
    intent.productType === "motherboard" && intent.sizes?.some((size) => /\bgb\b/i.test(size)) ? "memory support" : null,
    intent.brands?.length ? `preferred brands ${intent.brands.join(" or ")}` : null,
    intent.budget ? `budget ${intent.budget}` : null,
    intent.openBudget ? "show me what is in stock without a budget" : null
  ]
    .filter(Boolean)
    .join(" ");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function safeTimingEqual(left, right) {
  const leftBuffer = Buffer.from(left || "", "utf8");
  const rightBuffer = Buffer.from(right || "", "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function appUrl(request) {
  return (process.env.SHOPIFY_APP_URL || `http://${request.headers.host}`).replace(/\/+$/, "");
}

function appScopes() {
  return process.env.SHOPIFY_SCOPES || "read_products,read_inventory,read_locations,read_files";
}

function verifyShopifyHmac(params) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;
  const hmac = params.get("hmac");
  if (!hmac) return false;

  const message = [...params.entries()]
    .filter(([key]) => !["hmac", "signature"].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return safeTimingEqual(digest, hmac);
}

function verifyShopifyAdminRequest(request, url, requestedShop) {
  const rawQuery = request.headers["x-shopify-admin-query"];
  const params = new URLSearchParams(typeof rawQuery === "string" && rawQuery ? rawQuery : url.searchParams);
  const signedShop = normalizeShopDomain(params.get("shop") || "");
  if (signedShop && requestedShop !== signedShop) return false;
  return verifyShopifyHmac(params);
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [key, decodeURIComponent(value.join("=") || "")];
      })
  );
}

function setOAuthStateCookie(response, state) {
  const secure = process.env.RENDER ? " Secure;" : "";
  response.setHeader("Set-Cookie", `ai_concierge_oauth_state=${encodeURIComponent(state)}; HttpOnly; SameSite=None;${secure} Path=/; Max-Age=600`);
}

function signAdminSession(shop, expiresAt) {
  return crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET || "").update(`${shop}|${expiresAt}`).digest("hex");
}

function setAdminSessionCookie(response, shop) {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const signature = signAdminSession(shop, expiresAt);
  const secure = process.env.RENDER ? " Secure;" : "";
  response.setHeader("Set-Cookie", [
    `ai_concierge_oauth_state=; HttpOnly; SameSite=None;${secure} Path=/; Max-Age=0`,
    `ai_concierge_admin_session=${encodeURIComponent(`${shop}|${expiresAt}|${signature}`)}; HttpOnly; SameSite=None;${secure} Path=/; Max-Age=86400`
  ]);
}

function verifyAdminSessionCookie(request, requestedShop) {
  if (!process.env.SHOPIFY_API_SECRET) return false;
  const session = parseCookies(request).ai_concierge_admin_session || "";
  const [shop, expiresAtRaw, signature] = session.split("|");
  const expiresAt = Number(expiresAtRaw);
  if (!shop || !expiresAt || !signature) return false;
  if (Date.now() > expiresAt) return false;
  if (normalizeShopDomain(shop) !== requestedShop) return false;
  return safeTimingEqual(signAdminSession(shop, expiresAt), signature);
}

function adminAuthorized(request, url) {
  const requestedShop = normalizeShopDomain(url.searchParams.get("shop") || request.headers["x-shop-domain"] || "demo");
  if (verifyShopifyAdminRequest(request, url, requestedShop)) return true;
  if (verifyAdminSessionCookie(request, requestedShop)) return true;

  return !process.env.RENDER;
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function redirectTop(response, location) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><body><script>window.top.location.href=${JSON.stringify(location)};</script><a href="${location}">Continue to Shopify authorization</a></body></html>`);
}

function parseJsonObject(raw, fallback = {}) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeWidgetConfig(config = {}) {
  const parsed = parseJsonObject(config, {});
  return {
    launcherLabel: String(parsed.launcherLabel || "AI Concierge").slice(0, 60),
    launcherPosition: ["bottom-right", "bottom-left"].includes(parsed.launcherPosition) ? parsed.launcherPosition : "bottom-right",
    panelWidth: Math.min(520, Math.max(320, Number(parsed.panelWidth || 390))),
    panelHeight: Math.min(760, Math.max(420, Number(parsed.panelHeight || 680))),
    chatHeading: String(parsed.chatHeading || "Find the right gear").slice(0, 80),
    chatSubheading: String(parsed.chatSubheading || "Live guidance").slice(0, 80),
    welcomeMessage: String(
      parsed.welcomeMessage ||
        "Hi, I’m your AI Concierge. What should I call you while we shop?"
    ).slice(0, 260),
    inputPlaceholder: String(parsed.inputPlaceholder || "Tell me what you need, your budget, and how you'll use it...").slice(0, 160),
    quickPrompts: Array.isArray(parsed.quickPrompts)
      ? parsed.quickPrompts.map((prompt) => String(prompt).trim()).filter(Boolean).slice(0, 3)
      : ["Gaming + design", "Home office", "Accessories"]
  };
}

function publicShopConfig(shop) {
  if (!shop) return null;
  const { accessToken, ...publicShop } = shop;
  return publicShop;
}

function numericShopifyId(gid) {
  return String(gid || "").split("/").pop();
}

function isRealShopDomain(shopDomain) {
  return /\.myshopify\.com$/i.test(shopDomain) || /^[a-z0-9][a-z0-9-]*\.[a-z]{2,}$/i.test(shopDomain);
}

function cartVariantNumericId(product, variantId) {
  const selectedVariant = (product?.variants || []).find((variant) => variant.id === variantId || variant.numericId === variantId);
  return selectedVariant?.numericId || selectedVariant?.legacyResourceId || product?.numericVariantId || numericShopifyId(variantId);
}

function buildShopifyCartAddUrl(shopDomain, product, variantId, quantity) {
  const numericVariantId = cartVariantNumericId(product, variantId);
  if (!isRealShopDomain(shopDomain) || !/^\d+$/.test(numericVariantId)) return null;
  const url = new URL(`https://${shopDomain}/cart/add`);
  url.searchParams.set("id", numericVariantId);
  url.searchParams.set("quantity", String(Math.max(1, Number(quantity) || 1)));
  return url.toString();
}

function buildUserContext(message, history) {
  const userMessages = Array.isArray(history)
    ? history.filter((item) => item?.role === "user" && typeof item.content === "string").map((item) => item.content.trim())
    : [];
  const latestMessage = String(message || "").trim();
  const previousMessages = userMessages.slice(0, -1);
  const previousContext = previousMessages.slice(-3).join(" ");
  const latestTerms = latestMessage.toLowerCase();
  const contextTypeMatch = previousContext.match(
    productTypePattern
  );
  const latestHasProductType =
    productTypePattern.test(latestMessage);
  const latestHasReplacementSpec =
    /\b(instead|rather|different|other)\b/i.test(latestMessage) &&
    /\b(4k|8k|1080p|1440p|uhd|qhd|fhd|hdmi|vga|displayport|dp|usb[- ]?c|type[- ]?c|sata|nvme|m\.?2|ddr4|ddr5)\b/i.test(latestMessage);

  if (latestHasReplacementSpec && contextTypeMatch && !latestHasProductType) {
    return `${latestMessage} ${contextTypeMatch[1]}`;
  }

  const latestLooksLikeRefinement =
    /\b(anything|something|one|option|options|range|budget|under|below|cheaper|more expensive|less expensive|that|those|it|them|yes|no|show me|what about|m\.?2|nvme|sata|2\.5|3\.5|external|portable|internal|atx|m-atx|matx|itx|am4|am5|lga|skt|socket|ddr4|ddr5|\d{3,4}\s?w)\b/i.test(
      latestMessage
    ) && !productTypePattern.test(latestMessage);

  if (latestLooksLikeRefinement && previousMessages.length > 0 && !latestTerms.includes("instead")) {
    return [...previousMessages.slice(-3), latestMessage].join(" ");
  }

  return userMessages.length > 0 ? userMessages.slice(-4).join(" ") : latestMessage;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function beginOAuth(request, response, url) {
  const shop = normalizeShopDomain(url.searchParams.get("shop"));
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    sendJson(response, 400, { error: "A valid myshopify.com shop domain is required." });
    return;
  }
  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
    sendJson(response, 500, { error: "SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required for OAuth." });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", process.env.SHOPIFY_API_KEY);
  authUrl.searchParams.set("scope", appScopes());
  authUrl.searchParams.set("redirect_uri", `${appUrl(request)}/auth/callback`);
  authUrl.searchParams.set("state", state);
  setOAuthStateCookie(response, state);
  redirectTop(response, authUrl.toString());
}

async function finishOAuth(request, response, url) {
  const params = url.searchParams;
  const shop = normalizeShopDomain(params.get("shop"));
  const code = params.get("code");
  const state = params.get("state");
  const cookies = parseCookies(request);

  if (!verifyShopifyHmac(params)) {
    sendJson(response, 401, { error: "Invalid Shopify OAuth signature." });
    return;
  }
  if (!state || cookies.ai_concierge_oauth_state !== state) {
    sendJson(response, 401, { error: "Invalid Shopify OAuth state." });
    return;
  }
  if (!shop || !code) {
    sendJson(response, 400, { error: "Shop and OAuth code are required." });
    return;
  }

  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    })
  });
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    sendJson(response, 400, { error: tokenPayload.error_description || tokenPayload.error || "Could not complete Shopify OAuth." });
    return;
  }

  const existing = await getShop(shop);
  await upsertShop({
    shopDomain: shop,
    accessToken: tokenPayload.access_token,
    storefrontName: existing?.storefrontName || shop,
    marketType: existing?.marketType || null,
    assistantName: existing?.assistantName || "AI Concierge",
    themeColor: existing?.themeColor || null,
    logoUrl: existing?.logoUrl || null,
    supportEmail: existing?.supportEmail || null,
    salesEmail: existing?.salesEmail || null,
    widgetConfig: existing?.widgetConfig || {},
    preferredBrands: existing?.preferredBrands || {}
  });

  setAdminSessionCookie(response, shop);
  redirect(response, `${appUrl(request)}/admin.html?shop=${encodeURIComponent(shop)}`);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const isShopifyAdminEmbed = url.pathname === "/" && (url.searchParams.has("host") || url.searchParams.get("embedded") === "1");
  if (isShopifyAdminEmbed) {
    const requestedShop = normalizeShopDomain(url.searchParams.get("shop"));
    const shop = requestedShop ? await getShop(requestedShop) : null;
    if (requestedShop && !shop?.accessToken) {
      redirect(response, `/auth?shop=${encodeURIComponent(requestedShop)}`);
      return;
    }
  }
  const requestedPath = isShopifyAdminEmbed ? "admin.html" : url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedShop = normalizeShopDomain(url.searchParams.get("shop") || request.headers["x-shop-domain"] || "demo");

  if (request.method === "GET" && url.pathname === "/api/shops") {
    sendJson(response, 200, { shops: await listShops() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/products") {
    const products = await loadCatalog(requestedShop);
    const shop = await getShop(requestedShop);
    sendJson(response, 200, { shop: publicShopConfig(shop), products });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/shop-config") {
    const shop = await getShop(requestedShop);
    sendJson(response, 200, { shop: publicShopConfig(shop) });
    return;
  }

  if (url.pathname === "/api/admin/shop") {
    if (!adminAuthorized(request, url)) {
      sendJson(response, 401, { error: "Shopify Admin authentication is required. Open this page from Shopify Admin." });
      return;
    }

    if (request.method === "GET") {
      const shop = await getShop(requestedShop);
      sendJson(response, 200, { shop: publicShopConfig(shop) });
      return;
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      const existing = await getShop(requestedShop);
      const shop = await upsertShop({
        shopDomain: requestedShop,
        accessToken: body.accessToken || existing?.accessToken || null,
        storefrontName: body.storefrontName || requestedShop,
        marketType: body.marketType || null,
        assistantName: body.assistantName || "AI Concierge",
        themeColor: body.themeColor || null,
        logoUrl: body.logoUrl || null,
        supportEmail: body.supportEmail || null,
        salesEmail: body.salesEmail || null,
        widgetConfig: normalizeWidgetConfig(body.widgetConfig),
        preferredBrands: parseJsonObject(body.preferredBrands, {})
      });
      sendJson(response, 200, { shop: publicShopConfig(shop) });
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/admin/files") {
    if (!adminAuthorized(request, url)) {
      sendJson(response, 401, { error: "Shopify Admin authentication is required. Open this page from Shopify Admin." });
      return;
    }

    const shop = await getShop(requestedShop);
    if (!shop?.accessToken) {
      sendJson(response, 400, { error: `No Admin API token is saved for ${requestedShop}.` });
      return;
    }

    try {
      const data = await shopifyGraphql(
        `#graphql
          query ConciergeLogoFiles {
            files(first: 24, query: "media_type:IMAGE") {
              nodes {
                ... on MediaImage {
                  id
                  alt
                  image {
                    url
                    width
                    height
                  }
                }
                ... on GenericFile {
                  id
                  alt
                  url
                }
              }
            }
          }
        `,
        {},
        shop
      );
      const files = (data.files?.nodes || [])
        .map((file) => ({
          id: file.id,
          alt: file.alt || "",
          url: file.image?.url || file.url || "",
          width: file.image?.width || null,
          height: file.image?.height || null
        }))
        .filter((file) => file.url);
      sendJson(response, 200, { files });
    } catch (error) {
      sendJson(response, 400, {
        error: `${error.message} If this says access denied, add read_files to SHOPIFY_SCOPES and your Shopify app Admin API scopes, then redeploy.`
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/debug/search") {
    const products = await loadCatalog(requestedShop);
    const q = String(url.searchParams.get("q") || "").toLowerCase();
    const matches = products
      .filter((product) =>
        [product.name, product.category, product.description, ...(product.specs || []), ...(product.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 30)
      .map((product) => ({
        name: product.name,
        category: product.category,
        price: product.price,
        stock: product.stock,
        specs: product.specs,
        tags: product.tags,
        collections: product.collections,
        metafields: product.metafields,
        requestedIntents: requestedIntentNames(q),
        matchesRequestedIntents: productMatchesRequestedIntents(product, q),
        relevantForQuery: isRelevantProductForRequest(product, q)
      }));

    sendJson(response, 200, { query: q, count: matches.length, matches });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const { message, shop, history = [], customerLocation = null, shoppingIntent = null } = await readJson(request);
    const shopDomain = normalizeShopDomain(shop || requestedShop);
    if (!message || typeof message !== "string") {
      sendJson(response, 400, { error: "Message is required." });
      return;
    }

    const products = await loadCatalog(shopDomain);
    const shopConfig = await getShop(shopDomain);
    if (shopConfig && process.env.SALES_EMAIL) {
      shopConfig.salesEmail = process.env.SALES_EMAIL;
    }
    const nextShoppingIntent = updateShoppingIntent(shoppingIntent, message);
    const intentContext = shoppingIntentToText(nextShoppingIntent);
    const baseUserContext = intentContext || buildUserContext(message, history);
    const compatibilityContext = applyCompatibilityContext(products, baseUserContext);
    const webCompatibilityContext =
      compatibilityContext.referenceProduct && !/could not confirm/i.test(compatibilityContext.note || "")
        ? null
        : await researchCompatibilityWithWeb({ message: baseUserContext });
    const userContext = webCompatibilityContext?.text || compatibilityContext.text;
    const clarification = needsClarification(userContext);
    if (clarification.shouldClarify) {
      sendJson(response, 200, {
        shop: shopConfig,
        type: "clarification",
        message: `I can help with that. ${clarification.questions.join(" ")} Once I have that, I’ll recommend only in-stock products and explain the tradeoffs.`,
        recommendations: [],
        shoppingIntent: nextShoppingIntent
      });
      return;
    }

    const qualificationQuestions = getQualificationQuestions(userContext);
    if (qualificationQuestions.length > 0) {
      sendJson(response, 200, {
        shop: shopConfig,
        type: "clarification",
        message: `${qualificationQuestions.join(" ")} This helps me avoid recommending incompatible parts.`,
        recommendations: [],
        shoppingIntent: nextShoppingIntent
      });
      return;
    }

    const candidateRecommendations = recommendProducts(products, userContext, {
      preferredBrands: shopConfig?.preferredBrands || {}
    });
    let recommendations = candidateRecommendations.slice(0, 3);
    let source = "local";

    try {
      const aiRanking = await rankRecommendationsWithOpenAI({
        message: userContext,
        products: candidateRecommendations.slice(0, 12)
      });

      if (aiRanking?.recommendations?.length > 0) {
        const aiReasons = new Map(
          aiRanking.recommendations.map((item) => [item.variantId, Array.isArray(item.reasons) ? item.reasons : []])
        );
        recommendations = aiRanking.recommendations
          .map((item) => candidateRecommendations.find((product) => product.variantId === item.variantId))
          .filter(Boolean)
          .filter((product) => isRelevantProductForRequest(product, userContext))
          .slice(0, 3)
          .map((product) => ({
            ...product,
            reasons: aiReasons.get(product.variantId)?.length > 0 ? aiReasons.get(product.variantId).slice(0, 3) : product.reasons
          }));
        source = "openai";
      }
    } catch (error) {
      source = "local";
      console.warn(`OpenAI ranking unavailable: ${error.message}`);
    }

    const locationResult = applyLocationContext(recommendations, candidateRecommendations, products, userContext, customerLocation);
    recommendations = locationResult.recommendations;
    if (isCompatibilityUpgradeIntent(nextShoppingIntent, message) && recommendations.length > 1) {
      recommendations = recommendations.slice(0, 1);
    }
    const suggestions = recommendations.length === 0 ? suggestSimilarProducts(products, userContext, 3) : [];

    const recommendationMessage =
      recommendations.length > 0
        ? [
            "Here are the best matches from current stock. I’d lead with the first option unless your budget or compatibility needs change.",
            webCompatibilityContext?.note || compatibilityContext.note,
            isCompatibilityUpgradeIntent(nextShoppingIntent, message)
              ? "Because you gave a specific model or product code, I’m only showing one safest match. If you’re unsure, send your exact model number to the sales team for a quote before buying."
              : null,
            locationResult.note
          ]
            .filter(Boolean)
            .join(" ")
        : suggestions.length > 0
          ? "I could not find an exact in-stock match for that request. These are the closest similar products I found, so please check the model and colour carefully."
          : "I could not find a clear in-stock match for that request. Try checking the model number, colour, or product name.";

    sendJson(response, 200, {
      shop: shopConfig,
      type: "recommendations",
      source,
      message: recommendationMessage,
      recommendations,
      suggestions,
      compatibilitySensitive: isCompatibilityUpgradeIntent(nextShoppingIntent, message),
      webSources: webCompatibilityContext?.sources || [],
      shoppingIntent: nextShoppingIntent
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cart") {
    const { variantId, quantity = 1, shop } = await readJson(request);
    const shopDomain = normalizeShopDomain(shop || requestedShop);
    const products = await loadCatalog(shopDomain);
    const product = products.find((item) => item.variantId === variantId);

    if (!product) {
      sendJson(response, 404, { error: "Product variant not found." });
      return;
    }

    demoCart.push({ shopDomain, variantId, quantity });
    const shopCart = demoCart.filter((line) => line.shopDomain === shopDomain);
    const numericVariantId = cartVariantNumericId(product, variantId);
    const cartAddUrl = buildShopifyCartAddUrl(shopDomain, product, variantId, quantity);
    sendJson(response, 200, {
      cart: shopCart,
      count: shopCart.reduce((total, line) => total + line.quantity, 0),
      product,
      shopifyReady: {
        mode: cartAddUrl ? "online-store-cart-add" : "demo-cart",
        cartAddUrl,
        numericVariantId,
        mutation: "cartLinesAdd",
        merchandiseId: variantId,
        quantity
      }
    });
    return;
  }

  if (
    request.method === "POST" &&
    ["/api/shopify/webhooks/products/create", "/api/shopify/webhooks/products/update"].includes(url.pathname)
  ) {
    const rawBody = await readRawBody(request);
    const hmac = request.headers["x-shopify-hmac-sha256"];
    const webhookShop = normalizeShopDomain(request.headers["x-shopify-shop-domain"] || requestedShop);

    if (!verifyShopifyWebhook(rawBody, hmac)) {
      sendJson(response, 401, { error: "Invalid Shopify webhook signature." });
      return;
    }

    const product = normalizeWebhookProduct(JSON.parse(rawBody.toString("utf8")));
    if (!product) {
      sendJson(response, 200, { ok: true, skipped: true });
      return;
    }

    await upsertCatalogProduct(product, webhookShop);
    sendJson(response, 200, { ok: true, shop: webhookShop, productId: product.id });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/shopify/webhooks/products/delete") {
    const rawBody = await readRawBody(request);
    const hmac = request.headers["x-shopify-hmac-sha256"];
    const webhookShop = normalizeShopDomain(request.headers["x-shopify-shop-domain"] || requestedShop);

    if (!verifyShopifyWebhook(rawBody, hmac)) {
      sendJson(response, 401, { error: "Invalid Shopify webhook signature." });
      return;
    }

    const deletedProduct = JSON.parse(rawBody.toString("utf8"));
    const productId = `gid://shopify/Product/${deletedProduct.id}`;
    await removeCatalogProduct(productId, webhookShop);
    sendJson(response, 200, { ok: true, shop: webhookShop, productId });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/shopify/webhooks/inventory-levels/update") {
    const rawBody = await readRawBody(request);
    const hmac = request.headers["x-shopify-hmac-sha256"];
    const webhookShop = normalizeShopDomain(request.headers["x-shopify-shop-domain"] || requestedShop);

    if (!verifyShopifyWebhook(rawBody, hmac)) {
      sendJson(response, 401, { error: "Invalid Shopify webhook signature." });
      return;
    }

    const inventoryLevel = JSON.parse(rawBody.toString("utf8"));
    const numericInventoryItemId = inventoryLevel.inventory_item_id;
    const inventoryItemId = numericInventoryItemId ? `gid://shopify/InventoryItem/${numericInventoryItemId}` : null;
    const result = await updateInventoryLevel({
      shopDomain: webhookShop,
      inventoryItemId,
      locationId: inventoryLevel.location_id ? `gid://shopify/Location/${inventoryLevel.location_id}` : null,
      available: inventoryLevel.available
    });

    sendJson(response, 200, { ok: true, shop: webhookShop, ...result });
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/auth") {
      await beginOAuth(request, response, url);
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth/callback") {
      await finishOAuth(request, response, url);
      return;
    }

    if (request.url.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`AI Concierge running on ${host}:${port}`);
});
