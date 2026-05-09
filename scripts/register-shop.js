import { upsertShop } from "../lib/catalog-store.js";

function readArg(name) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

const shopDomain = readArg("shop") || process.env.SHOPIFY_SHOP;
const accessToken = readArg("token") || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const storefrontName = readArg("name") || process.env.SHOPIFY_STOREFRONT_NAME || shopDomain;
const marketType = readArg("market") || process.env.SHOPIFY_MARKET_TYPE || null;
const assistantName = readArg("assistant") || process.env.SHOPIFY_ASSISTANT_NAME || "AI Concierge";
const themeColor = readArg("color") || process.env.SHOPIFY_THEME_COLOR || null;
const preferredBrandsRaw = readArg("preferred-brands") || process.env.PREFERRED_BRANDS_JSON || "{}";

function parsePreferredBrands(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Preferred brands must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid preferred brand rules: ${error.message}`);
  }
}

if (!shopDomain) {
  throw new Error("Shop domain is required. Use --shop=your-store.myshopify.com");
}

if (!accessToken) {
  throw new Error("Admin API access token is required. Use --token=shpat_...");
}

const shop = await upsertShop({
  shopDomain,
  accessToken,
  storefrontName,
  marketType,
  assistantName,
  themeColor,
  preferredBrands: parsePreferredBrands(preferredBrandsRaw)
});

console.log(`Registered ${shop.shopDomain} for ${shop.assistantName}.`);
