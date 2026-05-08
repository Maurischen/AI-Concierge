import { loadCatalog } from "../lib/catalog-store.js";

const products = await loadCatalog();
console.log(`Database/catalog store is ready. Products available: ${products.length}`);
