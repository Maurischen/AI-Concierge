# AI Concierge MVP

This is a local storefront demo for a Shopify AI concierge. It has a small Node backend so product search, recommendations, cart actions, and future OpenAI/Shopify credentials do not live in the browser.

## What It Shows

- A storefront-style product grid backed by mock Shopify product and variant IDs.
- A conversational concierge for electronics needs.
- Stock-aware recommendation cards with reasons.
- Location-aware inventory answers for store/branch availability.
- Add-to-cart behavior that hands real Shopify shops to the native Shopify cart.
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
C:\Users\mauri\MWC_Apps\AI Concierge
```

Commit everything except files ignored by `.gitignore`, especially `.env`, `node_modules`, and `data/catalog-cache.json`.

## API Routes

- `GET /api/products` returns the current product catalog.
- `POST /api/chat` accepts `{ "message": "..." }` and returns clarification or recommendations.
- `POST /api/cart` accepts `{ "variantId": "...", "quantity": 1 }` and returns a Shopify cart-add URL for real shops, or a demo cart action locally.

## OpenAI Setup

Copy `.env.example` to `.env` when you are ready to use a real API key. This demo does not load `.env` automatically yet, so set environment variables in your shell before running the server:

```powershell
$env:OPENAI_API_KEY="your_api_key"
$env:OPENAI_MODEL="gpt-5.4-mini"
$env:OPENAI_AGENT_MODEL="gpt-5.4-mini"
$env:OPENAI_WEB_MODEL="gpt-5.4-mini"
$env:ENABLE_WEB_COMPATIBILITY="true"
$env:SALES_EMAIL="sales@example.com"
npm run dev
```

When `ENABLE_WEB_COMPATIBILITY=true`, the backend can use OpenAI web search for compatibility lookups when a customer mentions an existing device that is not in the Shopify catalog, such as "MSI Pulse GL76 laptop RAM upgrade." The app uses that external compatibility result only to add requirements like DDR generation, SODIMM/DIMM, M.2 NVMe, or PSU wattage before searching your in-stock catalog.

The primary chat flow uses an OpenAI tool-calling agent when `OPENAI_API_KEY` is set. The agent can call local catalog tools such as product search and product details, but final recommendations are still limited to real in-stock Shopify products returned by the backend. If the OpenAI request fails, the app falls back to the local matcher.

For compatibility-sensitive upgrade requests, the assistant shows one safest product recommendation and includes an email link so the customer can send their exact model number to the sales team before buying. Configure the address with `SALES_EMAIL`.

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

Each storefront should load the assistant through the Shopify theme app embed in `extensions/ai-concierge-theme`. Deploy the extension with Shopify CLI, then enable **AI Concierge** in **Online Store > Themes > Customize > App embeds**. No custom liquid or pasted script is needed.

## Shopify CLI Setup

The repo includes a Shopify CLI config at `shopify.app.toml` and the theme app extension at `extensions/ai-concierge-theme`.

Before deploying the extension, edit `shopify.app.toml`:

```toml
client_id = "your Shopify Partner app API key"
application_url = "https://your-render-url.onrender.com"

[auth]
redirect_urls = [
  "https://your-render-url.onrender.com/auth/callback"
]

[access_scopes]
scopes = "read_products,read_inventory,read_locations,read_files"

[build]
include_config_on_deploy = true
```

The same values must be set in Render:

```text
SHOPIFY_API_KEY=your Shopify Partner app API key
SHOPIFY_API_SECRET=your Shopify Partner app API secret
SHOPIFY_APP_URL=https://your-render-url.onrender.com
SHOPIFY_SCOPES=read_products,read_inventory,read_locations,read_files
```

Then deploy the app extension:

```bash
npm run shopify:deploy
```

After Shopify CLI finishes, manually enable the embed in Shopify Admin:

```text
Online Store > Themes > Customize > App embeds > AI Concierge
```

The embed first shows a visible `AI Concierge Loaded` marker. If that marker appears, the theme extension is active. Once `widget.js` loads, the marker is removed and the floating chat launcher appears.

## Admin UI

Open the app from Shopify Admin > Apps. If the shop has not authorized the app yet, it redirects through Shopify OAuth and stores the offline Admin API token automatically.

```text
https://your-render-url.onrender.com/auth?shop=your-store.myshopify.com
```

Render must have these Shopify app values set:

```text
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL=https://your-render-url.onrender.com
SHOPIFY_SCOPES=read_products,read_inventory,read_locations,read_files
```

In the Shopify Partner app setup, add this redirect URL:

```text
https://your-render-url.onrender.com/auth/callback
```

The admin UI can configure the storefront name, AI chat name, logo URL, theme colour, sales/support emails, market type, widget launcher label/position, panel size, chat copy, quick prompts, and preferred brands by product category. Settings save through Shopify-signed admin requests only.

To pick a logo from Shopify, upload the image in **Content > Files** in Shopify first, then use **Choose from Shopify files** in the AI Concierge admin screen.

## Shopify Catalog Sync

Do not put your full catalog in `script.js`. The frontend calls the backend, and the backend loads `data/catalog-cache.json`. If that cache does not exist yet, it falls back to the small demo catalog.

Set your Shopify Admin API details, then run a sync:

```powershell
$env:SHOPIFY_SHOP="your-store.myshopify.com"
$env:SHOPIFY_ADMIN_ACCESS_TOKEN="shpat_or_custom_app_token"
$env:SHOPIFY_API_VERSION="2026-01"
npm run sync:shopify
```

The sync script pulls active Shopify products with variants, prices, customer-fulfillable inventory by location, tags, vendor, type, descriptions, and featured images, then writes `data/catalog-cache.json`.

If `DATABASE_URL` is set, the same sync writes products into Postgres instead of the local JSON cache. Render will provide `DATABASE_URL` automatically if you deploy with `render.yaml`. Product rows are stored per `shop_domain`.

For automatic updates, register these Shopify webhooks against your deployed app URL:

- `products/create` -> `/api/shopify/webhooks/products/create`
- `products/update` -> `/api/shopify/webhooks/products/update`
- `products/delete` -> `/api/shopify/webhooks/products/delete`
- `inventory_levels/update` -> `/api/shopify/webhooks/inventory-levels/update`

Set `SHOPIFY_WEBHOOK_SECRET` in production so webhook requests are verified before they update the local catalog cache.

Your Shopify app/custom app needs these Admin API scopes:

```text
read_products,read_inventory,read_locations,read_files
```

`read_inventory` lets the app read inventory levels by variant. `read_locations` lets it read the location name/address attached to those inventory levels, which is what powers questions like "is this available at the Windhoek branch?" If you add `read_locations` after the app was already installed, reinstall or re-authorize the Shopify app/custom app token, update the token in Render, redeploy if needed, then run:

`read_files` lets the admin UI list image files from Shopify Files so you can choose a stored logo without pasting a URL manually.

Only active Shopify locations with `fulfillsOnlineOrders: true` are used for customer-facing availability, so supplier/internal locations are not shown as pickup or nearby store options.

```bash
npm run sync:shopify -- --shop=your-store.myshopify.com
```

For "closest store" questions, the browser can ask the customer for location permission on HTTPS. The app only sends latitude/longitude to the backend for that chat request and uses Shopify location coordinates to rank stocked branches by distance.

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
5. Replace the cart handoff with Storefront API cart mutations if you want customers to stay inside the embedded experience instead of opening Shopify's cart URL.
6. Package the UI into a Shopify theme app extension.
