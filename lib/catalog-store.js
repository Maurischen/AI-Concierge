import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { products as demoProducts } from "../data/products.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const catalogPath = join(root, "data", "catalog-cache.json");
const defaultShopDomain = process.env.DEFAULT_SHOP_DOMAIN || "demo";
let poolPromise = null;

async function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!poolPromise) {
    poolPromise = import("pg").then(({ Pool }) => {
      return new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.RENDER ? { rejectUnauthorized: false } : false
      });
    });
  }
  return poolPromise;
}

async function ensureCatalogTable() {
  const pool = await getPool();
  if (!pool) return null;

  await pool.query(`
    create table if not exists shops (
      shop_domain text primary key,
      access_token text,
      storefront_name text,
      market_type text,
      assistant_name text not null default 'AI Concierge',
      theme_color text,
      logo_url text,
      support_email text,
      sales_email text,
      widget_config jsonb not null default '{}'::jsonb,
      preferred_brands jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await pool.query(`
    alter table shops
    add column if not exists preferred_brands jsonb not null default '{}'::jsonb
  `);

  await pool.query(`
    alter table shops
    add column if not exists widget_config jsonb not null default '{}'::jsonb
  `);

  await pool.query(`
    alter table shops
    add column if not exists logo_url text,
    add column if not exists support_email text,
    add column if not exists sales_email text
  `);

  await pool.query(`
    create table if not exists catalog_products (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  await pool.query(`
    create table if not exists ai_concierge_orders (
      shop_domain text not null,
      order_id text not null,
      order_name text,
      customer_email text,
      total_price numeric,
      currency text,
      session_id text,
      line_items jsonb not null default '[]'::jsonb,
      note_attributes jsonb not null default '[]'::jsonb,
      raw_order jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (shop_domain, order_id)
    )
  `);

  await pool.query(`
    alter table catalog_products
    add column if not exists shop_domain text not null default 'demo'
  `);

  await pool.query(`
    do $$
    begin
      if exists (
        select 1
        from pg_constraint
        where conname = 'catalog_products_pkey'
          and conrelid = 'catalog_products'::regclass
      ) then
        alter table catalog_products drop constraint catalog_products_pkey;
      end if;

      if not exists (
        select 1
        from pg_constraint
        where conname = 'catalog_products_shop_domain_id_pkey'
          and conrelid = 'catalog_products'::regclass
      ) then
        alter table catalog_products
        add constraint catalog_products_shop_domain_id_pkey primary key (shop_domain, id);
      end if;
    end
    $$;
  `);

  return pool;
}

export function normalizeShopDomain(shopDomain) {
  return String(shopDomain || defaultShopDomain).trim().toLowerCase();
}

export async function getShop(shopDomain) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  const pool = await ensureCatalogTable();
  if (!pool) {
    return {
      shopDomain: normalizedShop,
      assistantName: "AI Concierge",
      storefrontName: "Demo Store",
      marketType: "demo",
      themeColor: null,
      logoUrl: null,
      supportEmail: null,
      salesEmail: process.env.SALES_EMAIL || null,
      widgetConfig: {}
    };
  }

  const result = await pool.query("select * from shops where shop_domain = $1", [normalizedShop]);
  if (!result.rows[0]) return null;

  const shop = result.rows[0];
  return {
    shopDomain: shop.shop_domain,
    accessToken: shop.access_token,
    storefrontName: shop.storefront_name,
    marketType: shop.market_type,
    assistantName: shop.assistant_name,
    themeColor: shop.theme_color,
    logoUrl: shop.logo_url,
    supportEmail: shop.support_email,
    salesEmail: shop.sales_email || process.env.SALES_EMAIL || null,
    widgetConfig: shop.widget_config || {},
    preferredBrands: shop.preferred_brands || {}
  };
}

export async function upsertShop(shop) {
  const normalizedShop = normalizeShopDomain(shop.shopDomain);
  const pool = await ensureCatalogTable();
  if (!pool) {
    return {
      shopDomain: normalizedShop,
      assistantName: shop.assistantName || "AI Concierge",
      storefrontName: shop.storefrontName || normalizedShop,
      marketType: shop.marketType || null,
      widgetConfig: shop.widgetConfig || {}
    };
  }

  await pool.query(
    `insert into shops (
      shop_domain,
      access_token,
      storefront_name,
      market_type,
      assistant_name,
      theme_color,
      logo_url,
      support_email,
      sales_email,
      widget_config,
      preferred_brands,
      updated_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
    on conflict (shop_domain) do update set
      access_token = coalesce(excluded.access_token, shops.access_token),
      storefront_name = excluded.storefront_name,
      market_type = excluded.market_type,
      assistant_name = excluded.assistant_name,
      theme_color = excluded.theme_color,
      logo_url = excluded.logo_url,
      support_email = excluded.support_email,
      sales_email = excluded.sales_email,
      widget_config = excluded.widget_config,
      preferred_brands = excluded.preferred_brands,
      updated_at = now()`,
    [
      normalizedShop,
      shop.accessToken || null,
      shop.storefrontName || normalizedShop,
      shop.marketType || null,
      shop.assistantName || "AI Concierge",
      shop.themeColor || null,
      shop.logoUrl || null,
      shop.supportEmail || null,
      shop.salesEmail || null,
      shop.widgetConfig || {},
      shop.preferredBrands || {}
    ]
  );

  return getShop(normalizedShop);
}

export async function listShops() {
  const pool = await ensureCatalogTable();
  if (!pool) return [];
  const result = await pool.query("select shop_domain, storefront_name, market_type, assistant_name, theme_color, logo_url, support_email, sales_email, widget_config, preferred_brands from shops order by shop_domain");
  return result.rows.map((shop) => ({
    shopDomain: shop.shop_domain,
    storefrontName: shop.storefront_name,
    marketType: shop.market_type,
    assistantName: shop.assistant_name,
    themeColor: shop.theme_color,
    logoUrl: shop.logo_url,
    supportEmail: shop.support_email,
    salesEmail: shop.sales_email || process.env.SALES_EMAIL || null,
    widgetConfig: shop.widget_config || {},
    preferredBrands: shop.preferred_brands || {}
  }));
}

export async function loadCatalog(shopDomain = defaultShopDomain) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  const pool = await ensureCatalogTable();
  if (pool) {
    const result = await pool.query("select data from catalog_products where shop_domain = $1 order by data->>'name'", [
      normalizedShop
    ]);
    if (result.rows.length > 0) {
      return result.rows.map((row) => row.data);
    }
  }

  try {
    const raw = await readFile(catalogPath, "utf8");
    const catalog = JSON.parse(raw);
    if (Array.isArray(catalog.products) && catalog.products.length > 0) return catalog.products;
    if (catalog.shops?.[normalizedShop]?.products?.length > 0) return catalog.shops[normalizedShop].products;
    return demoProducts;
  } catch {
    return demoProducts;
  }
}

export async function saveCatalog(products, shopDomain = defaultShopDomain) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  const pool = await ensureCatalogTable();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from catalog_products where shop_domain = $1", [normalizedShop]);
      for (const product of products) {
        await client.query(
          "insert into catalog_products (shop_domain, id, data, updated_at) values ($1, $2, $3, now()) on conflict (shop_domain, id) do update set data = excluded.data, updated_at = now()",
          [normalizedShop, product.id, { ...product, shopDomain: normalizedShop }]
        );
      }
      await client.query("commit");
      return;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  await writeFile(
    catalogPath,
    JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        shopDomain: normalizedShop,
        products
      },
      null,
      2
    )
  );
}

export async function upsertCatalogProduct(product, shopDomain = defaultShopDomain) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  const pool = await ensureCatalogTable();
  if (pool) {
    await pool.query(
      "insert into catalog_products (shop_domain, id, data, updated_at) values ($1, $2, $3, now()) on conflict (shop_domain, id) do update set data = excluded.data, updated_at = now()",
      [normalizedShop, product.id, { ...product, shopDomain: normalizedShop }]
    );
    return loadCatalog(normalizedShop);
  }

  const products = await loadCatalog(normalizedShop);
  const next = products.filter((item) => item.id !== product.id);
  next.push({ ...product, shopDomain: normalizedShop });
  await saveCatalog(next.sort((a, b) => a.name.localeCompare(b.name)), normalizedShop);
  return next;
}

export async function removeCatalogProduct(productId, shopDomain = defaultShopDomain) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  const pool = await ensureCatalogTable();
  if (pool) {
    await pool.query("delete from catalog_products where shop_domain = $1 and id = $2", [normalizedShop, productId]);
    return loadCatalog(normalizedShop);
  }

  const products = await loadCatalog(normalizedShop);
  const next = products.filter((item) => item.id !== productId);
  await saveCatalog(next, normalizedShop);
  return next;
}

export async function updateInventoryLevel({ shopDomain = defaultShopDomain, inventoryItemId, locationId = null, available }) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  if (!inventoryItemId || available === undefined || available === null) {
    return { updated: false, reason: "Missing inventory item ID or available quantity." };
  }

  const products = await loadCatalog(normalizedShop);
  let updatedProduct = null;

  const next = products.map((product) => {
    let productChanged = false;
    const variants = (product.variants || []).map((variant) => {
      if (variant.inventoryItemId !== inventoryItemId) return variant;
      productChanged = true;
      const inventoryByLocation = locationId
        ? [
            ...(variant.inventoryByLocation || []).filter((location) => location.id !== locationId),
            ...((variant.inventoryByLocation || []).some((location) => location.id === locationId)
              ? [
                  {
                    ...(variant.inventoryByLocation || []).find((location) => location.id === locationId),
                    available: Number(available)
                  }
                ]
              : [])
          ]
        : variant.inventoryByLocation || [];
      const summedLocationStock = inventoryByLocation.reduce((total, location) => total + Number(location.available || 0), 0);
      return {
        ...variant,
        inventoryByLocation,
        stock: summedLocationStock > 0 ? summedLocationStock : Number(available)
      };
    });

    if (!productChanged) return product;

    const topVariant = variants.find((variant) => variant.id === product.variantId) || variants[0];
    updatedProduct = {
      ...product,
      variants,
      stock: Number(topVariant?.stock || 0)
    };
    return updatedProduct;
  });

  if (!updatedProduct) {
    return { updated: false, reason: "Inventory item was not found in the cached catalog." };
  }

  await saveCatalog(next, normalizedShop);
  return { updated: true, product: updatedProduct };
}

function propertyListToObject(properties = []) {
  if (!Array.isArray(properties)) return properties && typeof properties === "object" ? properties : {};
  return properties.reduce((result, property) => {
    const key = property.name || property.key;
    if (key) result[key] = property.value;
    return result;
  }, {});
}

function orderAttributeValue(attributes = [], key) {
  const normalizedKey = key.toLowerCase();
  const match = attributes.find((attribute) => String(attribute.name || attribute.key || "").toLowerCase() === normalizedKey);
  return match?.value || null;
}

export async function recordConciergeOrder(order, shopDomain = defaultShopDomain) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  const noteAttributes = Array.isArray(order.note_attributes) ? order.note_attributes : [];
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const aiLines = lineItems.filter((item) => {
    const properties = propertyListToObject(item.properties);
    return properties._ai_concierge === "true" || properties._AIConcierge === "true";
  });
  const orderTagged =
    orderAttributeValue(noteAttributes, "ai_concierge__") === "true" ||
    orderAttributeValue(noteAttributes, "AI Concierge") === "true";

  if (!orderTagged && aiLines.length === 0) {
    return { tracked: false, reason: "Order was not attributed to AI Concierge." };
  }

  const sessionId =
    orderAttributeValue(noteAttributes, "ai_concierge_session__") ||
    orderAttributeValue(noteAttributes, "AI Concierge Session") ||
    propertyListToObject(aiLines[0]?.properties)._ai_concierge_session ||
    null;

  const trackedLines = (aiLines.length > 0 ? aiLines : lineItems).map((item) => ({
    id: item.id,
    variantId: item.variant_id,
    productId: item.product_id,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    price: item.price,
    properties: propertyListToObject(item.properties)
  }));

  const pool = await ensureCatalogTable();
  if (!pool) {
    return { tracked: true, stored: false, reason: "DATABASE_URL is not configured.", sessionId };
  }

  const orderId = String(order.admin_graphql_api_id || order.id || order.order_number || "");
  await pool.query(
    `insert into ai_concierge_orders (
      shop_domain,
      order_id,
      order_name,
      customer_email,
      total_price,
      currency,
      session_id,
      line_items,
      note_attributes,
      raw_order,
      updated_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
    on conflict (shop_domain, order_id) do update set
      order_name = excluded.order_name,
      customer_email = excluded.customer_email,
      total_price = excluded.total_price,
      currency = excluded.currency,
      session_id = excluded.session_id,
      line_items = excluded.line_items,
      note_attributes = excluded.note_attributes,
      raw_order = excluded.raw_order,
      updated_at = now()`,
    [
      normalizedShop,
      orderId,
      order.name || `#${order.order_number || ""}`,
      order.email || order.contact_email || null,
      Number(order.total_price || order.current_total_price || 0),
      order.currency || order.presentment_currency || null,
      sessionId,
      trackedLines,
      noteAttributes,
      order
    ]
  );

  return { tracked: true, stored: true, orderId, sessionId, lineItemCount: trackedLines.length };
}
