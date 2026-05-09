# AI Concierge MVP

This is a local storefront demo for a Shopify AI concierge. It has a small Node backend so product search, recommendations, cart actions, and future OpenAI/Shopify credentials do not live in the browser.

## What It Shows

- A storefront-style product grid backed by mock Shopify product and variant IDs.
- A conversational concierge for electronics needs.
- Stock-aware recommendation cards with reasons.
- Add-to-cart behavior that records selected variant IDs.
- Backend API routes for product data, chat recommendations, and cart actions.
- An OpenAI-ready backend integration that uses the local matcher when no API key is configured.

## Run It

```powershell
npm run dev
```

Then open `http://127.0.0.1:5174/`.

## Files To Upload To GitHub

Upload this whole project folder:

```text
C:\Users\mauri\Documents\Codex\2026-05-08\i-would-like-to-build-an
```

Commit everything except files ignored by `.gitignore`, especially `.env`, `node_modules`, and `data/catalog-cache.json`.

## API Routes

- `GET /api/products` returns the current product catalog.
- `POST /api/chat` accepts `{ "message": "..." }` and returns clarification or recommendations.
- `POST /api/cart` accepts `{ "variantId": "...", "quantity": 1 }` and returns a Shopify-ready cart action.

## OpenAI Setup

Copy `.env.example` to `.env` when you are ready to use a real API key. This demo does not load `.env` automatically yet, so set environment variables in your shell before running the server:

```powershell
$env:OPENAI_API_KEY="your_api_key"
$env:OPENAI_MODEL="gpt-5.4-mini"
npm run dev
```

## Multi-Shop Setup

AI Concierge is designed to support multiple Shopify stores from one Render app. Each store gets its own shop record and product catalog in Postgres.

Register each shop after setting `DATABASE_URL` on Render:

```bash
npm run register:shop -- --shop=first-store.myshopify.com --token=shpat_first_token --name="Business IT Advisor" --market=business --assistant="Business IT Advisor"
npm run register:shop -- --shop=second-store.myshopify.com --token=shpat_second_token --name="Home Tech Concierge" --market=consumer --assistant="Home Tech Concierge"
```

You can also set preferred brands by category. These brands get boosted when the customer asks for a matching product type:

```bash
npm run register:shop -- --shop=first-store.myshopify.com --token=shpat_first_token --preferred-brands='{"cable":["UGreen"],"hub":["UGreen"],"adapter":["UGreen"],"bag":["Port Designs"]}'
```

On Render, if pasting JSON into the shell is awkward, add this as an environment variable and run `npm run register:shop` again:

```text
PREFERRED_BRANDS_JSON={"cable":["UGreen"],"hub":["UGreen"],"adapter":["UGreen"],"bag":["Port Designs"]}
```

Then sync one shop:

```bash
npm run sync:shopify -- --shop=first-store.myshopify.com
```

Register Shopify webhooks for one shop:

```bash
npm run register:webhooks -- --shop=first-store.myshopify.com
```

Or sync all registered shops:

```bash
npm run sync:shopify
```

Or register webhooks for all registered shops:

```bash
npm run register:webhooks
```

Each storefront should load the assistant with its shop domain:

```html
<iframe
  src="https://your-render-url.onrender.com?shop=first-store.myshopify.com"
  style="width: 100%; height: 800px; border: 0;"
></iframe>
```

## Shopify Catalog Sync

Do not put your full catalog in `script.js`. The frontend calls the backend, and the backend loads `data/catalog-cache.json`. If that cache does not exist yet, it falls back to the small demo catalog.

Set your Shopify Admin API details, then run a sync:

```powershell
$env:SHOPIFY_SHOP="your-store.myshopify.com"
$env:SHOPIFY_ADMIN_ACCESS_TOKEN="shpat_or_custom_app_token"
$env:SHOPIFY_API_VERSION="2026-01"
npm run sync:shopify
```

The sync script pulls active Shopify products with variants, prices, inventory, tags, vendor, type, descriptions, and featured images, then writes `data/catalog-cache.json`.

If `DATABASE_URL` is set, the same sync writes products into Postgres instead of the local JSON cache. Render will provide `DATABASE_URL` automatically if you deploy with `render.yaml`. Product rows are stored per `shop_domain`.

For automatic updates, register these Shopify webhooks against your deployed app URL:

- `products/create` -> `/api/shopify/webhooks/products/create`
- `products/update` -> `/api/shopify/webhooks/products/update`
- `products/delete` -> `/api/shopify/webhooks/products/delete`
- `inventory_levels/update` -> `/api/shopify/webhooks/inventory-levels/update`

Set `SHOPIFY_WEBHOOK_SECRET` in production so webhook requests are verified before they update the local catalog cache.

Your Shopify app/custom app needs these Admin API scopes:

```text
read_products,read_inventory
```

## Render Deployment

This repo includes `render.yaml`, which defines:

- A Node web service.
- A Render Postgres database.
- A `DATABASE_URL` connection from the web service to the database.

In Render:

1. Push this folder to GitHub.
2. In Render, choose **New > Blueprint**.
3. Connect the GitHub repo.
4. Render will read `render.yaml` and create the web service plus database.
5. Add these secret environment variables on the web service:
   - `OPENAI_API_KEY`
   - `SHOPIFY_WEBHOOK_SECRET`
6. After deploy, open the service shell or run a one-off job with:

```bash
npm run register:shop -- --shop=your-store.myshopify.com --token=your_admin_api_token --name="Store Assistant"
npm run sync:shopify -- --shop=your-store.myshopify.com
```

That initial sync loads the 4,000+ product catalog into Postgres for that shop. Repeat the register/sync commands for each Shopify store. After that, product webhooks keep each shop updated automatically.

## Next Shopify Integration Steps

1. Deploy the backend so Shopify can reach the webhook URLs.
2. Register the product webhooks in each Shopify custom app or public app.
3. Add richer product attributes for electronics, such as RAM, CPU, storage, GPU, wattage, compatibility, and warranty.
4. Use OpenAI tool calling so the assistant can call `search_products`, `compare_products`, and `add_to_cart`.
5. Replace the demo cart handler with Shopify Storefront API cart mutations.
6. Package the UI into a Shopify theme app extension.
