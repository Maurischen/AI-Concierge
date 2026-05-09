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
import { rankRecommendationsWithOpenAI } from "./lib/openai.js";
import { isRelevantProductForRequest, needsClarification, recommendProducts } from "./lib/recommendations.js";
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

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
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
        metafields: product.metafields
      }));

    sendJson(response, 200, { query: q, count: matches.length, matches });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const { message, shop, history = [] } = await readJson(request);
    const shopDomain = normalizeShopDomain(shop || requestedShop);
    if (!message || typeof message !== "string") {
      sendJson(response, 400, { error: "Message is required." });
      return;
    }

    const userContext = Array.isArray(history)
      ? history
          .filter((item) => item?.role === "user" && typeof item.content === "string")
          .slice(-4)
          .map((item) => item.content)
          .join(" ")
      : message;
    const products = await loadCatalog(shopDomain);
    const shopConfig = await getShop(shopDomain);
    const clarification = needsClarification(userContext);
    if (clarification.shouldClarify) {
      sendJson(response, 200, {
        shop: shopConfig,
        type: "clarification",
        message: `I can help with that. ${clarification.questions.join(" ")} Once I have that, I’ll recommend only in-stock products and explain the tradeoffs.`,
        recommendations: []
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

    const recommendationMessage =
      recommendations.length > 0
        ? "Here are the best matches from current stock. I’d lead with the first option unless your budget or compatibility needs change."
        : "I could not find a clear in-stock match for that request. Try widening the budget or checking that the matching products are tagged, collected, or metafielded clearly in Shopify.";

    sendJson(response, 200, {
      shop: shopConfig,
      type: "recommendations",
      source,
      message: recommendationMessage,
      recommendations
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
