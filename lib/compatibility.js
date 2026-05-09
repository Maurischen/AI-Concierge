function textFromProduct(product) {
  return [
    product.searchText,
    product.name,
    product.category,
    product.vendor,
    product.description,
    ...(product.specs || []),
    ...(product.tags || []),
    ...(product.collections || []).map((collection) => collection.title),
    ...(product.metafields || []).map((metafield) => `${metafield.key} ${metafield.value}`),
    ...(product.variants || []).map((variant) => variant.sku)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function requestedReferenceTokens(text) {
  const terms = String(text || "").toLowerCase().replace(/(\d)\s+(\d{3})/g, "$1$2");
  return [
    ...new Set(
      terms.match(/\b[a-z]{1,8}\d{2,8}[a-z0-9-]*\b|\b[a-z]+\d+[a-z0-9-]*\b/g)?.filter((token) => {
        if (["ddr4", "ddr5", "cat5", "cat6", "cat6a", "cat7", "cat8"].includes(token)) return false;
        return token.length >= 4;
      }) || []
    )
  ];
}

function requestWantsRam(text) {
  return /\b(ram|memory|dimm|sodimm|ddr3|ddr4|ddr5)\b/i.test(text);
}

function requestWantsCpu(text) {
  return /\b(cpu|processor|ryzen|intel core|core i[3579])\b/i.test(text);
}

function isMotherboard(product) {
  const text = textFromProduct(product);
  return /\b(motherboard|mainboard|m-atx|matx|mini-itx|itx|lga|am4|am5)\b/.test(text);
}

function scoreReferenceProduct(product, tokens) {
  const text = textFromProduct(product);
  return tokens.reduce((score, token) => {
    const exact = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
    return score + (exact ? 20 : text.includes(token) ? 8 : 0);
  }, 0);
}

function findReferenceProduct(products, text) {
  const tokens = requestedReferenceTokens(text);
  if (tokens.length === 0) return null;

  return products
    .map((product) => ({
      product,
      score: scoreReferenceProduct(product, tokens)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)))[0]?.product || null;
}

function inferRamContext(referenceProduct) {
  const text = textFromProduct(referenceProduct);
  const specs = [];
  const notes = [];

  if (/\bddr5\b/.test(text)) {
    specs.push("ddr5");
    notes.push("DDR5 memory");
  } else if (/\bddr4\b/.test(text)) {
    specs.push("ddr4");
    notes.push("DDR4 memory");
  }

  if (/\bsodimm\b|\bso-dimm\b/.test(text)) {
    specs.push("sodimm");
    notes.push("SODIMM form factor");
  } else if (/\budimm\b|\bdimm\b|\bdesktop\b|\bmotherboard\b/.test(text)) {
    specs.push("desktop dimm");
    notes.push("desktop DIMM form factor");
  }

  return { specs, notes };
}

function inferCpuContext(referenceProduct) {
  const text = textFromProduct(referenceProduct);
  const specs = [];
  const notes = [];
  const socket = text.match(/\b(am4|am5|lga\s?\d{3,5})\b/i)?.[1];

  if (socket) {
    const normalizedSocket = socket.replace(/\s+/g, "").toUpperCase();
    specs.push(normalizedSocket);
    notes.push(`${normalizedSocket} socket`);
  }

  return { specs, notes };
}

export function applyCompatibilityContext(products, text) {
  const referenceProduct = findReferenceProduct(products, text);
  if (!referenceProduct) return { text, referenceProduct: null, note: null };

  const referenceIsMotherboard = isMotherboard(referenceProduct);
  let compatibility = { specs: [], notes: [] };

  if (referenceIsMotherboard && requestWantsRam(text)) {
    compatibility = inferRamContext(referenceProduct);
  } else if (referenceIsMotherboard && requestWantsCpu(text)) {
    compatibility = inferCpuContext(referenceProduct);
  }

  if (compatibility.specs.length === 0) {
    return { text, referenceProduct, note: `I found ${referenceProduct.name}, but I could not confirm the required compatibility details from its product data.` };
  }

  const compatibleText = `${text.replace(/\b(motherboard|mainboard)\b/gi, "")} ${compatibility.specs.join(" ")}`;
  return {
    text: compatibleText,
    referenceProduct,
    note: `I matched your compatibility reference to ${referenceProduct.name} and used ${compatibility.notes.join(", ")}.`
  };
}
