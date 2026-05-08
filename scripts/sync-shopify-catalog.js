import { saveCatalog } from "../lib/catalog-store.js";
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
          }
        }
      }
    }
  }
`;

let cursor = null;
let hasNextPage = true;
const products = [];

while (hasNextPage) {
  const data = await shopifyGraphql(query, { cursor });
  const connection = data.products;

  for (const product of connection.nodes) {
    const normalized = normalizeAdminProduct(product);
    if (normalized && normalized.stock > 0) {
      products.push(normalized);
    }
  }

  hasNextPage = connection.pageInfo.hasNextPage;
  cursor = connection.pageInfo.endCursor;
  console.log(`Synced ${products.length} products so far...`);
}

await saveCatalog(products);
console.log(`Catalog sync complete. Saved ${products.length} in-stock products.`);
