export async function rankRecommendationsWithOpenAI({ message, products }) {
  if (!process.env.OPENAI_API_KEY || products.length === 0) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      input: [
        {
          role: "system",
          content:
            "You are an electronics product matching engine. Choose only from the supplied products. Do not recommend a product if it is the wrong product type. RAM requests must exclude flash drives, SD cards, SSDs, and storage devices. Reply with JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            customer_request: message,
            products: products.map((product) => ({
              variantId: product.variantId,
              name: product.name,
              category: product.category,
              price: product.price,
              stock: product.stock,
              description: product.description,
              specs: product.specs,
              tags: product.tags,
              searchText: product.searchText
            })),
            output_shape: {
              recommendations: [
                {
                  variantId: "gid://shopify/ProductVariant/example",
                  reasons: ["reason one", "reason two"]
                }
              ]
            }
          })
        }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || [])?.find((item) => item.text)?.text;
  if (!text) return null;

  return JSON.parse(text);
}
