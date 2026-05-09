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

function needsExternalCompatibilityLookup(message = "") {
  const terms = String(message).toLowerCase();
  const asksForUpgrade =
    /\b(upgrade|compatible|work with|works with|for my|for a|for an|i have|existing)\b/.test(terms) &&
    /\b(ram|memory|ssd|hdd|hard drive|storage|psu|power supply)\b/.test(terms);
  const hasDeviceModel = /\b[a-z]{2,}\s?[a-z0-9-]*\d{2,}[a-z0-9-]*\b/i.test(message);
  return asksForUpgrade && hasDeviceModel;
}

function extractOutputText(payload) {
  return payload.output_text || payload.output?.flatMap((item) => item.content || [])?.find((item) => item.text)?.text || "";
}

function extractWebSources(payload) {
  const fromSources = Array.isArray(payload.sources)
    ? payload.sources.map((source) => ({
        title: source.title || source.url,
        url: source.url
      }))
    : [];
  const fromAnnotations =
    payload.output
      ?.flatMap((item) => item.content || [])
      ?.flatMap((content) => content.annotations || [])
      ?.filter((annotation) => annotation.type === "url_citation")
      ?.map((annotation) => ({
        title: annotation.title || annotation.url,
        url: annotation.url
      })) || [];

  return [...fromSources, ...fromAnnotations]
    .filter((source) => source.url)
    .filter((source, index, sources) => sources.findIndex((item) => item.url === source.url) === index)
    .slice(0, 3);
}

export async function researchCompatibilityWithWeb({ message }) {
  if (!process.env.OPENAI_API_KEY || process.env.ENABLE_WEB_COMPATIBILITY === "false" || !needsExternalCompatibilityLookup(message)) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_WEB_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini",
      tools: [{ type: "web_search" }],
      input: [
        {
          role: "system",
          content:
            "You research computer hardware compatibility. Use web search only to identify compatibility requirements for the referenced existing device. Return JSON only. Do not invent facts. If you cannot verify requirements, return shouldUse false."
        },
        {
          role: "user",
          content: JSON.stringify({
            customer_request: message,
            task:
              "Find the referenced existing device model and infer only the requirements needed to recommend stocked upgrade products. For RAM include DDR generation and DIMM/SODIMM form factor when verified. For storage include M.2 NVMe, M.2 SATA, 2.5 SATA, capacity limits, or number of slots when verified. For PSU/GPU include minimum wattage when verified.",
            output_shape: {
              shouldUse: true,
              referenceProduct: "MSI Pulse GL76",
              targetProduct: "ram",
              requirements: ["ddr4", "sodimm"],
              note: "Verified MSI Pulse GL76 uses DDR4 SODIMM laptop memory."
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
    console.warn(`OpenAI web compatibility lookup failed with ${response.status}`);
    return null;
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  if (!outputText) return null;

  try {
    const result = JSON.parse(outputText);
    if (!result.shouldUse || !Array.isArray(result.requirements) || result.requirements.length === 0) return null;

    const requirements = result.requirements.map((item) => String(item).toLowerCase()).filter(Boolean).slice(0, 8);
    const targetProduct = result.targetProduct ? String(result.targetProduct).toLowerCase() : "";
    const researchedText = [message, requirements.join(" "), targetProduct].filter(Boolean).join(" ");
    const sources = extractWebSources(payload);

    return {
      text: researchedText,
      note: [
        result.referenceProduct ? `I checked compatibility for ${result.referenceProduct}` : "I checked external compatibility information",
        result.note ? `and used: ${result.note}` : `and used: ${requirements.join(", ")}.`
      ].join(" "),
      sources
    };
  } catch (error) {
    console.warn(`Could not parse web compatibility result: ${error.message}`);
    return null;
  }
}
