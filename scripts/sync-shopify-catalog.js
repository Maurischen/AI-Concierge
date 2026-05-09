import { getShop, listShops, saveCatalog } from "../lib/catalog-store.js";
import { normalizeAdminProduct, shopifyGraphql } from "../lib/shopify.js";

const query = `#graphql
  query ProductsForConcierge($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        vendor
        productType
        tags
        descriptionHtml
        totalInventory
        featuredMedia {
          preview {
            image {
              url
            }
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            inventoryQuantity
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

async function syncShop(shop) {
  let cursor = null;
  let hasNextPage = true;
  const products = [];

  console.log(`Syncing ${shop.shopDomain}...`);

  while (hasNextPage) {
    const data = await shopifyGraphql(query, { cursor }, shop);
    const connection = data.products;

    for (const product of connection.nodes) {
      const normalized = normalizeAdminProduct(product);
      if (normalized && normalized.stock > 0) {
        products.push({ ...normalized, shopDomain: shop.shopDomain });
      }
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
    console.log(`Synced ${products.length} products for ${shop.shopDomain} so far...`);
  }

  await saveCatalog(products, shop.shopDomain);
  console.log(`Catalog sync complete for ${shop.shopDomain}. Saved ${products.length} in-stock products.`);
}

const shopArg = process.argv.find((arg) => arg.startsWith("--shop="))?.split("=")[1];

if (shopArg) {
  const shop = await getShop(shopArg);
  if (!shop) throw new Error(`Shop ${shopArg} is not registered. Run npm run register:shop first.`);
  await syncShop(shop);
} else if (process.env.SHOPIFY_SHOP && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
  await syncShop({
    shopDomain: process.env.SHOPIFY_SHOP,
    accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
  });
} else {
  const shops = await listShops();
  if (shops.length === 0) {
    throw new Error("No registered shops found. Run npm run register:shop first.");
  }

  for (const shopSummary of shops) {
    const shop = await getShop(shopSummary.shopDomain);
    if (shop?.accessToken) {
      await syncShop(shop);
    } else {
      console.warn(`Skipping ${shopSummary.shopDomain}: missing access token.`);
    }
  }
}
