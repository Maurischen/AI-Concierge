import { getShop, listShops } from "../lib/catalog-store.js";
import { shopifyGraphql } from "../lib/shopify.js";

const appUrl = (process.env.SHOPIFY_APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");

if (!appUrl) {
  throw new Error("SHOPIFY_APP_URL is required, for example https://ai-concierge-qkhn.onrender.com");
}

const webhookSubscriptions = [
  {
    topic: "PRODUCTS_CREATE",
    path: "/api/shopify/webhooks/products/create"
  },
  {
    topic: "PRODUCTS_UPDATE",
    path: "/api/shopify/webhooks/products/update"
  },
  {
    topic: "PRODUCTS_DELETE",
    path: "/api/shopify/webhooks/products/delete"
  },
  {
    topic: "INVENTORY_LEVELS_UPDATE",
    path: "/api/shopify/webhooks/inventory-levels/update"
  },
  {
    topic: "METAFIELDS_CREATE",
    path: "/api/shopify/webhooks/metafields/update"
  },
  {
    topic: "METAFIELDS_UPDATE",
    path: "/api/shopify/webhooks/metafields/update"
  },
  {
    topic: "METAFIELDS_DELETE",
    path: "/api/shopify/webhooks/metafields/update"
  },
  {
    topic: "ORDERS_CREATE",
    path: "/api/shopify/webhooks/orders/create"
  }
];

const mutation = `#graphql
  mutation CreateWebhookSubscription($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        uri
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function registerForShop(shop) {
  console.log(`Registering webhooks for ${shop.shopDomain}...`);

  for (const subscription of webhookSubscriptions) {
    const uri = `${appUrl}${subscription.path}`;
    const data = await shopifyGraphql(
      mutation,
      {
        topic: subscription.topic,
        webhookSubscription: { uri }
      },
      shop
    );

    const result = data.webhookSubscriptionCreate;
    const duplicate = result.userErrors.some((error) => /taken|already/i.test(error.message));

    if (result.webhookSubscription) {
      console.log(`Created ${subscription.topic} -> ${uri}`);
    } else if (duplicate) {
      console.log(`Already exists ${subscription.topic} -> ${uri}`);
    } else if (result.userErrors.length > 0) {
      console.warn(`Could not create ${subscription.topic}: ${result.userErrors.map((error) => error.message).join("; ")}`);
    }
  }
}

const shopArg = process.argv.find((arg) => arg.startsWith("--shop="))?.split("=")[1];

if (shopArg) {
  const shop = await getShop(shopArg);
  if (!shop) throw new Error(`Shop ${shopArg} is not registered. Run npm run register:shop first.`);
  await registerForShop(shop);
} else if (process.env.SHOPIFY_SHOP && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
  await registerForShop({
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
      await registerForShop(shop);
    } else {
      console.warn(`Skipping ${shopSummary.shopDomain}: missing access token.`);
    }
  }
}
