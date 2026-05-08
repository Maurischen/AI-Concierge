export async function createOpenAIRecommendation({ message, products }) {
  if (!process.env.OPENAI_API_KEY) {
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
            "You are an electronics sales concierge for a Shopify store. Recommend only products supplied in the catalog. Explain fit, tradeoffs, and ask for clarification when needed."
        },
        {
          role: "user",
          content: JSON.stringify({
            customer_message: message,
            available_products: products
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  return response.json();
}
