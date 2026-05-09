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
  upsertCatalogProduct
} from "./lib/catalog-store.js";
import { applyLocationContext } from "./lib/locations.js";
import { rankRecommendationsWithOpenAI } from "./lib/openai.js";
import { getQualificationQuestions, isRelevantProductForRequest, needsClarification, recommendProducts, suggestSimilarProducts } from "./lib/recommendations.js";
import { productMatchesRequestedIntents, requestedIntentNames } from "./lib/product-intents.js";
import { normalizeWebhookProduct, verifyShopifyWebhook } from "./lib/shopify.js";

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
  /\b(cable|charger|power bank|powerbank|monitor|screen|display|ram|memory|ssd|hdd|hard drive|flash drive|usb drive|laptop|desktop|keyboard|mouse|steering wheel|racing wheel|wheel|router|switch|printer|toner|ink|cartridge|webcam|headset|speaker|microphone|motherboard|cpu|processor|graphics card|gpu|bag|backpack)\b/i;

function normalizeIntentText(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

function extractProductType(text) {
  const match = normalizeIntentText(text).match(productTypePattern);
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (["screen", "display"].includes(type)) return "monitor";
  if (["powerbank"].includes(type)) return "power bank";
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

function budgetIsOpen(text) {
  return /\b(i don'?t have a budget|i don'?t know|not sure|no budget|without a budget|any budget|show me|what is available|what'?s available|what is in stock|what'?s in stock|available stock)\b/i.test(
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
    /\b(nvme|sata|m\.?2|2\.5|3\.5|ddr4|ddr5|am4|am5|lga\s?\d+|atx|m-atx|matx|itx)\b/g,
    /\b(\d{3,4}\s?w)\b/g
  ];

  for (const pattern of patterns) {
    for (const match of terms.matchAll(pattern)) specs.push(match[1].replace(/\s+/g, " "));
  }

  return [...new Set(specs)];
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
  const latestProductType = extractProductType(latest);
  const productTypeChanged = latestProductType && previousIntent?.productType && latestProductType !== previousIntent.productType;
  const baseIntent = productTypeChanged ? null : previousIntent;
  const productType = latestProductType || baseIntent?.productType || null;
  const specs = extractIntentSpecs(latest);
  const sizes = extractSizes(latest);
  const modelTokens = extractModelTokens(latest);
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
    brands: brands.length > 0 ? brands : baseIntent?.brands || []
  };
}

function shoppingIntentToText(intent) {
  if (!intent?.productType) return "";
  return [
    intent.sizes?.join(" "),
    intent.modelTokens?.join(" "),
    intent.specs?.join(" "),
    intent.productType,
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
    /\b(anything|something|one|option|options|range|budget|under|below|cheaper|more expensive|less expensive|that|those|it|them|yes|no|show me|what about|m\.?2|nvme|sata|2\.5|3\.5|external|portable|internal|atx|m-atx|matx|itx|am4|am5|lga|ddr4|ddr5|\d{3,4}\s?w)\b/i.test(
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

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
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
    sendJson(response, 200, { shop, products });
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

    const nextShoppingIntent = updateShoppingIntent(shoppingIntent, message);
    const intentContext = shoppingIntentToText(nextShoppingIntent);
    const userContext = intentContext || buildUserContext(message, history);
    const products = await loadCatalog(shopDomain);
    const shopConfig = await getShop(shopDomain);
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
    const suggestions = recommendations.length === 0 ? suggestSimilarProducts(products, userContext, 3) : [];

    const recommendationMessage =
      recommendations.length > 0
        ? [
            "Here are the best matches from current stock. I’d lead with the first option unless your budget or compatibility needs change.",
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
    sendJson(response, 200, {
      cart: shopCart,
      count: shopCart.reduce((total, line) => total + line.quantity, 0),
      product,
      shopifyReady: {
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
