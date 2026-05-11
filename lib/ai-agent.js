import { recommendProducts } from "./recommendations.js";

function productSummary(product) {
  return {
    variantId: product.variantId,
    name: product.name,
    category: product.category,
    vendor: product.vendor,
    price: product.price,
    stock: product.stock,
    description: String(product.description || "").slice(0, 420),
    specs: (product.specs || []).slice(0, 12),
    tags: (product.tags || []).slice(0, 20)
  };
}

function extractOutputText(payload) {
  return payload.output_text || payload.output?.flatMap((item) => item.content || [])?.find((item) => item.text)?.text || "";
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function productMap(products) {
  return new Map(products.map((product) => [product.variantId, product]));
}

function normalizeRecommendations(result, productsByVariant) {
  const items = Array.isArray(result?.recommendations) ? result.recommendations : [];
  return items
    .map((item) => {
      const product = productsByVariant.get(item.variantId);
      if (!product) return null;
      return {
        ...product,
        reasons: Array.isArray(item.reasons) && item.reasons.length > 0 ? item.reasons.slice(0, 3).map(String) : product.reasons || []
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function buildConversationContext(history = []) {
  return history
    .slice(-8)
    .map((item) => `${item.role === "assistant" ? "Assistant" : "Customer"}: ${item.content}`)
    .join("\n");
}

function tools() {
  return [
    {
      type: "function",
      name: "search_products",
      description:
        "Search the merchant's live in-stock Shopify catalog. Use this before recommending products. Query should include product type, compatibility details, size/capacity, connector, brand preference, and budget when known.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query for stocked products, for example '32GB DDR4 desktop DIMM RAM under 3000'."
          },
          limit: {
            type: "number",
            description: "Maximum products to return. Use 3 to 8."
          }
        },
        required: ["query"]
      }
    },
    {
      type: "function",
      name: "get_product_details",
      description: "Get full catalog details for one product variant already returned by search_products.",
      parameters: {
        type: "object",
        properties: {
          variantId: {
            type: "string",
            description: "The Shopify product variant GID from search_products."
          }
        },
        required: ["variantId"]
      }
    }
  ];
}

function callTool(name, args, { products, preferredBrands }) {
  if (name === "search_products") {
    const query = String(args.query || "").trim();
    const limit = Math.min(8, Math.max(1, Number(args.limit || 6)));
    if (!query) {
      return { products: [] };
    }

    const recommendations = recommendProducts(products, query, {
      preferredBrands,
      limit
    });

    return {
      query,
      products: recommendations.map(productSummary)
    };
  }

  if (name === "get_product_details") {
    const product = products.find((item) => item.variantId === args.variantId);
    return product ? productSummary(product) : { error: "Product not found" };
  }

  return { error: `Unknown tool: ${name}` };
}

async function createResponse(body) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`OpenAI agent request failed with ${response.status}`);
  }

  return response.json();
}

export async function runShoppingAgent({ message, products, shopConfig, history = [], shoppingIntent = null }) {
  if (!process.env.OPENAI_API_KEY || products.length === 0) return null;

  const productsByVariant = productMap(products);
  const preferredBrands = shopConfig?.preferredBrands || {};
  const model = process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const input = [
    {
      role: "system",
      content:
        "You are a practical electronics shopping assistant for a Shopify store. You have general computer hardware knowledge, but you may recommend only products returned by tools from the merchant's live catalog. Ask a short follow-up question when required compatibility details are missing. For RAM upgrades, reason about total capacity, current module layout, slot count, DDR generation, and DIMM/SODIMM form factor. If the customer has 2x16GB and wants 64GB, do not recommend 16GB modules unless they have at least 4 slots and need two more matching sticks. If slot count or motherboard/laptop model is missing, ask for it. Return JSON only."
    },
    {
      role: "user",
      content: JSON.stringify({
        customer_request: message,
        conversation_context: buildConversationContext(history),
        current_shopping_intent: shoppingIntent,
        store_rules: {
          currency: "ZAR",
          recommend_only_in_stock_products: true,
          use_only_tool_products: true,
          preferredBrands
        },
        output_shape: {
          type: "recommendations or clarification",
          message: "customer-facing answer",
          recommendations: [
            {
              variantId: "gid://shopify/ProductVariant/example",
              reasons: ["specific fit reason", "stock or budget reason"]
            }
          ],
          compatibilitySensitive: false
        }
      })
    }
  ];

  let response = await createResponse({
    model,
    input,
    tools: tools(),
    tool_choice: "auto",
    parallel_tool_calls: false,
    text: {
      format: {
        type: "json_object"
      }
    }
  });

  for (let i = 0; i < 3; i += 1) {
    const functionCalls = (response.output || []).filter((item) => item.type === "function_call");
    if (functionCalls.length === 0) break;

    input.push(...response.output);
    for (const toolCall of functionCalls) {
      const args = safeJsonParse(toolCall.arguments, {});
      const output = callTool(toolCall.name, args, {
        products,
        preferredBrands
      });
      input.push({
        type: "function_call_output",
        call_id: toolCall.call_id,
        output: JSON.stringify(output)
      });
    }

    response = await createResponse({
      model,
      input,
      tools: tools(),
      tool_choice: "auto",
      parallel_tool_calls: false,
      text: {
        format: {
          type: "json_object"
        }
      }
    });
  }

  const outputText = extractOutputText(response);
  const result = safeJsonParse(outputText, null);
  if (!result?.message) return null;

  const recommendations = normalizeRecommendations(result, productsByVariant);
  const type = result.type === "clarification" || recommendations.length === 0 ? "clarification" : "recommendations";

  return {
    shop: shopConfig,
    type,
    source: "openai-agent",
    message: String(result.message),
    recommendations: type === "recommendations" ? recommendations : [],
    suggestions: [],
    compatibilitySensitive: Boolean(result.compatibilitySensitive),
    webSources: [],
    shoppingIntent,
    agentPowered: true
  };
}
