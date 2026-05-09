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
    create table if not exists catalog_products (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
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
      marketType: "demo"
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
      marketType: shop.marketType || null
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
      preferred_brands,
      updated_at
    ) values ($1, $2, $3, $4, $5, $6, $7, now())
    on conflict (shop_domain) do update set
      access_token = coalesce(excluded.access_token, shops.access_token),
      storefront_name = excluded.storefront_name,
      market_type = excluded.market_type,
      assistant_name = excluded.assistant_name,
      theme_color = excluded.theme_color,
      preferred_brands = excluded.preferred_brands,
      updated_at = now()`,
    [
      normalizedShop,
      shop.accessToken || null,
      shop.storefrontName || normalizedShop,
      shop.marketType || null,
      shop.assistantName || "AI Concierge",
      shop.themeColor || null,
      shop.preferredBrands || {}
    ]
  );

  return getShop(normalizedShop);
}

export async function listShops() {
  const pool = await ensureCatalogTable();
  if (!pool) return [];
  const result = await pool.query("select shop_domain, storefront_name, market_type, assistant_name, theme_color, preferred_brands from shops order by shop_domain");
  return result.rows.map((shop) => ({
    shopDomain: shop.shop_domain,
    storefrontName: shop.storefront_name,
    marketType: shop.market_type,
    assistantName: shop.assistant_name,
    themeColor: shop.theme_color,
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

export async function updateInventoryLevel({ shopDomain = defaultShopDomain, inventoryItemId, available }) {
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
      return {
        ...variant,
        stock: Number(available)
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
