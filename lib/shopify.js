import crypto from "node:crypto";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function shopifyGraphql(query, variables = {}, shopConfig = {}) {
  const shop = shopConfig.shopDomain || process.env.SHOPIFY_SHOP;
  const token = shopConfig.accessToken || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";

  if (!shop) throw new Error("Shop domain is required.");
  if (!token) throw new Error(`Admin API access token is required for ${shop}.`);

  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(JSON.stringify(payload.errors || payload, null, 2));
  }

  return payload.data;
}

export function verifyShopifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!hmacHeader) return false;

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

function cleanText(value = "") {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function variantFromAdminProduct(product) {
  return product.variants?.nodes?.find((variant) => Number(variant.inventoryQuantity || 0) > 0) || product.variants?.nodes?.[0];
}

function variantFromWebhookProduct(product) {
  return product.variants?.find((variant) => Number(variant.inventory_quantity || 0) > 0) || product.variants?.[0];
}

function normalizeMetafields(metafields = []) {
  const list = Array.isArray(metafields) ? metafields : metafields?.nodes || [];
  return list
    .filter(Boolean)
    .map((metafield) => ({
      namespace: metafield.namespace,
      key: metafield.key,
      value: cleanText(String(metafield.value || "")),
      type: metafield.type
    }))
    .filter((metafield) => metafield.value);
}

function metafieldValue(metafields, key) {
  return normalizeMetafields(metafields).find((metafield) => metafield.namespace === "custom" && metafield.key === key)?.value || "";
}

function parseBooleanMetafield(value) {
  return /^(true|1|yes)$/i.test(String(value || "").trim());
}

function parseNumberMetafield(value) {
  const number = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

export function normalizeVariantPromotion(variant) {
  const metafields = normalizeMetafields(variant?.metafields || []);
  const enabled = parseBooleanMetafield(metafieldValue(metafields, "promo_display_enabled"));
  const type = metafieldValue(metafields, "promo_display_type").trim().toUpperCase();
  const discountAmount = parseNumberMetafield(metafieldValue(metafields, "promo_discount_amount"));
  const discountPercent = parseNumberMetafield(metafieldValue(metafields, "promo_discount_percent"));
  const normalPrice = Number(variant?.price || 0);
  const fixedPromo = type === "FIXED" && discountAmount > 0;
  const percentagePromo = type === "PERCENTAGE" && discountPercent > 0;
  const active = enabled && (fixedPromo || percentagePromo);
  const discountedPrice = fixedPromo
    ? Math.max(0, normalPrice - discountAmount)
    : percentagePromo
      ? Math.max(0, normalPrice * ((100 - discountPercent) / 100))
      : normalPrice;

  return {
    active,
    type: type || null,
    discountAmount,
    discountPercent,
    normalPrice,
    discountedPrice: Math.round(discountedPrice * 100) / 100,
    savings: Math.max(0, Math.round((normalPrice - discountedPrice) * 100) / 100),
    label: metafieldValue(metafields, "promo_label") || null,
    source: metafieldValue(metafields, "promo_source") || null,
    priority: parseNumberMetafield(metafieldValue(metafields, "promo_priority")),
    metafields
  };
}

function buildSearchText(parts) {
  return parts
    .flat()
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeLocation(location) {
  if (!location) return null;
  return {
    id: location.id,
    name: location.name,
    fulfillsOnlineOrders: location.fulfillsOnlineOrders === true,
    isActive: location.isActive !== false,
    address: {
      address1: location.address?.address1 || null,
      address2: location.address?.address2 || null,
      city: location.address?.city || null,
      province: location.address?.province || null,
      zip: location.address?.zip || null,
      country: location.address?.country || null,
      latitude: location.address?.latitude ?? null,
      longitude: location.address?.longitude ?? null
    }
  };
}

function normalizeInventoryLevels(levels = []) {
  return levels
    .map((level) => {
      const location = normalizeLocation(level.location);
      if (!location) return null;
      if (!location.isActive || !location.fulfillsOnlineOrders) return null;
      return {
        ...location,
        available: Number(level.quantities?.find((quantity) => quantity.name === "available")?.quantity || 0)
      };
    })
    .filter(Boolean);
}

function numericShopifyId(value) {
  return String(value || "").split("/").pop();
}

function normalizeVariantNumericId(variant) {
  return variant?.legacyResourceId ? String(variant.legacyResourceId) : numericShopifyId(variant?.id || variant?.admin_graphql_api_id);
}

export function normalizeAdminProduct(product) {
  const variant = variantFromAdminProduct(product);
  if (!variant) return null;

  const stock = Number(variant.inventoryQuantity || product.totalInventory || 0);
  const image = product.featuredMedia?.preview?.image;
  const collections = product.collections?.nodes || [];
  const metafields = normalizeMetafields(product.metafields?.nodes || []);
  const promotion = normalizeVariantPromotion(variant);
  const collectionTitles = collections.map((collection) => collection.title);
  const metafieldValues = metafields.map((metafield) => `${metafield.key} ${metafield.value}`);
  const promotionValues = promotion.active
    ? [
        promotion.label,
        promotion.source,
        promotion.type,
        promotion.discountAmount ? `promo discount amount ${promotion.discountAmount}` : null,
        promotion.discountPercent ? `promo discount percent ${promotion.discountPercent}` : null
      ].filter(Boolean)
    : [];
  const tags = [
    ...(product.tags || []),
    product.productType,
    product.vendor,
    ...collectionTitles,
    ...metafields.map((metafield) => metafield.value),
    ...promotionValues
  ]
    .filter(Boolean)
    .map((tag) => String(tag).toLowerCase());
  const specs = [
    product.vendor,
    product.productType,
    ...collectionTitles,
    ...metafieldValues.slice(0, 8),
    ...promotionValues,
    variant.sku ? `SKU ${variant.sku}` : null,
    product.tags?.slice(0, 3).join(", ")
  ].filter(Boolean);

  return {
    id: product.id,
    variantId: variant.id,
    numericVariantId: normalizeVariantNumericId(variant),
    handle: product.handle,
    name: product.title,
    category: product.productType || "electronics",
    vendor: product.vendor,
    price: Number(variant.price || 0),
    sku: variant.sku || null,
    promotion,
    stock,
    badge: product.vendor?.slice(0, 4) || product.title.slice(0, 3),
    imageUrl: image?.url || null,
    collections: collections.map((collection) => ({
      title: collection.title,
      handle: collection.handle
    })),
    metafields,
    specs,
    tags: [...new Set(tags)],
    description: cleanText(product.descriptionHtml || product.description || ""),
    searchText: buildSearchText([
      product.title,
      product.vendor,
      product.productType,
      product.tags || [],
      collectionTitles,
      product.descriptionHtml,
      metafieldValues,
      promotionValues,
      variant.sku
    ]),
    variants: product.variants.nodes.map((item) => ({
      id: item.id,
      numericId: normalizeVariantNumericId(item),
      legacyResourceId: item.legacyResourceId ? String(item.legacyResourceId) : null,
      inventoryItemId: item.inventoryItem?.id || null,
      inventoryByLocation: normalizeInventoryLevels(item.inventoryItem?.inventoryLevels?.nodes || []),
      title: item.title,
      sku: item.sku,
      price: Number(item.price || 0),
      metafields: normalizeMetafields(item.metafields || []),
      promotion: normalizeVariantPromotion(item),
      stock: Number(item.inventoryQuantity || 0)
    }))
  };
}

export function normalizeWebhookProduct(product) {
  const variant = variantFromWebhookProduct(product);
  if (!variant) return null;

  const image = product.image || product.images?.[0];
  const promotion = normalizeVariantPromotion(variant);
  const tags = String(product.tags || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  return {
    id: `gid://shopify/Product/${product.admin_graphql_api_id?.split("/").pop() || product.id}`,
    variantId: variant.admin_graphql_api_id || `gid://shopify/ProductVariant/${variant.id}`,
    numericVariantId: variant.id ? String(variant.id) : normalizeVariantNumericId(variant),
    handle: product.handle,
    name: product.title,
    category: product.product_type || "electronics",
    vendor: product.vendor,
    price: Number(variant.price || 0),
    sku: variant.sku || null,
    promotion,
    stock: Number(variant.inventory_quantity || 0),
    badge: product.vendor?.slice(0, 4) || product.title.slice(0, 3),
    imageUrl: image?.src || null,
    specs: [product.vendor, product.product_type, variant.sku ? `SKU ${variant.sku}` : null].filter(Boolean),
    tags,
    description: cleanText(product.body_html || ""),
    searchText: buildSearchText([product.title, product.vendor, product.product_type, tags, product.body_html, variant.sku]),
    variants: (product.variants || []).map((item) => ({
      id: item.admin_graphql_api_id || `gid://shopify/ProductVariant/${item.id}`,
      numericId: item.id ? String(item.id) : normalizeVariantNumericId(item),
      legacyResourceId: item.id ? String(item.id) : null,
      inventoryItemId: item.inventory_item_id ? `gid://shopify/InventoryItem/${item.inventory_item_id}` : null,
      inventoryByLocation: [],
      title: item.title,
      sku: item.sku,
      price: Number(item.price || 0),
      metafields: normalizeMetafields(item.metafields || []),
      promotion: normalizeVariantPromotion(item),
      stock: Number(item.inventory_quantity || 0)
    }))
  };
}
