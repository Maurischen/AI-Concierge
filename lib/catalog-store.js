import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { products as demoProducts } from "../data/products.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const catalogPath = join(root, "data", "catalog-cache.json");
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
    create table if not exists catalog_products (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  return pool;
}

export async function loadCatalog() {
  const pool = await ensureCatalogTable();
  if (pool) {
    const result = await pool.query("select data from catalog_products order by data->>'name'");
    if (result.rows.length > 0) {
      return result.rows.map((row) => row.data);
    }
  }

  try {
    const raw = await readFile(catalogPath, "utf8");
    const catalog = JSON.parse(raw);
    return Array.isArray(catalog.products) && catalog.products.length > 0 ? catalog.products : demoProducts;
  } catch {
    return demoProducts;
  }
}

export async function saveCatalog(products) {
  const pool = await ensureCatalogTable();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from catalog_products");
      for (const product of products) {
        await client.query(
          "insert into catalog_products (id, data, updated_at) values ($1, $2, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
          [product.id, product]
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
        products
      },
      null,
      2
    )
  );
}

export async function upsertCatalogProduct(product) {
  const pool = await ensureCatalogTable();
  if (pool) {
    await pool.query(
      "insert into catalog_products (id, data, updated_at) values ($1, $2, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
      [product.id, product]
    );
    return loadCatalog();
  }

  const products = await loadCatalog();
  const next = products.filter((item) => item.id !== product.id);
  next.push(product);
  await saveCatalog(next.sort((a, b) => a.name.localeCompare(b.name)));
  return next;
}

export async function removeCatalogProduct(productId) {
  const pool = await ensureCatalogTable();
  if (pool) {
    await pool.query("delete from catalog_products where id = $1", [productId]);
    return loadCatalog();
  }

  const products = await loadCatalog();
  const next = products.filter((item) => item.id !== productId);
  await saveCatalog(next);
  return next;
}
