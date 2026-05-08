import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, removeCatalogProduct, upsertCatalogProduct } from "./lib/catalog-store.js";
import { createOpenAIRecommendation } from "./lib/openai.js";
import { needsClarification, recommendProducts } from "./lib/recommendations.js";
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

  if (request.method === "GET" && url.pathname === "/api/products") {
    const products = await loadCatalog();
    sendJson(response, 200, { products });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const { message } = await readJson(request);
    if (!message || typeof message !== "string") {
      sendJson(response, 400, { error: "Message is required." });
      return;
    }

    const products = await loadCatalog();
    const clarification = needsClarification(message);
    if (clarification.shouldClarify) {
      sendJson(response, 200, {
        type: "clarification",
        message: `I can help with that. ${clarification.questions.join(" ")} Once I have that, I’ll recommend only in-stock products and explain the tradeoffs.`,
        recommendations: []
      });
      return;
    }

    const recommendations = recommendProducts(products, message);

    try {
      const openaiResponse = await createOpenAIRecommendation({ message, products: recommendations });
      sendJson(response, 200, {
        type: "recommendations",
        source: openaiResponse ? "openai" : "local",
        message:
          "Here are the best matches from current stock. I’d lead with the first option unless your budget or portability needs change.",
        recommendations,
        openaiResponse
      });
    } catch (error) {
      sendJson(response, 200, {
        type: "recommendations",
        source: "local",
        message:
          "Here are the best matches from current stock. The AI service was unavailable, so I used the local product matcher.",
        recommendations,
        warning: error.message
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cart") {
    const { variantId, quantity = 1 } = await readJson(request);
    const products = await loadCatalog();
    const product = products.find((item) => item.variantId === variantId);

    if (!product) {
      sendJson(response, 404, { error: "Product variant not found." });
      return;
    }

    demoCart.push({ variantId, quantity });
    sendJson(response, 200, {
      cart: demoCart,
      count: demoCart.reduce((total, line) => total + line.quantity, 0),
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

    if (!verifyShopifyWebhook(rawBody, hmac)) {
      sendJson(response, 401, { error: "Invalid Shopify webhook signature." });
      return;
    }

    const product = normalizeWebhookProduct(JSON.parse(rawBody.toString("utf8")));
    if (!product) {
      sendJson(response, 200, { ok: true, skipped: true });
      return;
    }

    await upsertCatalogProduct(product);
    sendJson(response, 200, { ok: true, productId: product.id });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/shopify/webhooks/products/delete") {
    const rawBody = await readRawBody(request);
    const hmac = request.headers["x-shopify-hmac-sha256"];

    if (!verifyShopifyWebhook(rawBody, hmac)) {
      sendJson(response, 401, { error: "Invalid Shopify webhook signature." });
      return;
    }

    const deletedProduct = JSON.parse(rawBody.toString("utf8"));
    const productId = `gid://shopify/Product/${deletedProduct.id}`;
    await removeCatalogProduct(productId);
    sendJson(response, 200, { ok: true, productId });
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
