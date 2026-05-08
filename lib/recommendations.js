function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

export function scoreProduct(product, text) {
  const terms = text.toLowerCase();
  let score = 0;

  for (const tag of product.tags) {
    if (terms.includes(tag)) score += 3;
  }

  if (terms.includes("laptop") && product.category === "laptop") score += 5;
  if (terms.includes("desktop") && product.category === "desktop") score += 5;
  if (terms.includes("monitor") && product.category === "monitor") score += 5;
  if (terms.includes("accessor") && product.category === "accessory") score += 5;
  if (terms.includes("gaming") && product.tags.includes("performance")) score += 3;
  if ((terms.includes("design") || terms.includes("cad")) && product.tags.includes("design")) score += 4;
  if ((terms.includes("office") || terms.includes("work")) && product.tags.includes("office")) score += 4;
  if ((terms.includes("home") || terms.includes("wifi")) && product.tags.includes("home")) score += 4;

  const budgetMatch = terms.match(/\$?(\d{3,5})/);
  if (budgetMatch) {
    const budget = Number(budgetMatch[1]);
    if (product.price <= budget) score += 4;
    if (product.price > budget) score -= 5;
  }

  if (product.stock > 0) score += 2;

  return score;
}

export function reasonsFor(product, text) {
  const terms = text.toLowerCase();
  const reasons = [];

  if (product.tags.includes("performance")) {
    reasons.push("Strong CPU/GPU pairing for demanding workloads.");
  }
  if (product.tags.includes("design")) {
    reasons.push("Good fit for creative or visual work based on its display/performance profile.");
  }
  if (product.tags.includes("office")) {
    reasons.push("Practical for daily productivity, meetings, and multitasking.");
  }
  if (product.tags.includes("usb-c")) {
    reasons.push("USB-C support makes docking and cable management easier.");
  }
  if (terms.includes("under") || /\$?\d{3,5}/.test(terms)) {
    reasons.push(`Stays close to the budget at ${money(product.price)}.`);
  }
  if (product.stock > 0) {
    reasons.push(`Available now with ${product.stock} in stock.`);
  }

  return reasons.slice(0, 3);
}

export function recommendProducts(products, text) {
  const terms = text.toLowerCase();
  const requestedCategory = ["laptop", "desktop", "monitor"].find((category) => terms.includes(category));
  const wantsBundle = /(setup|bundle|accessor|complete)/i.test(text);
  const budgetMatch = terms.match(/\$?(\d{3,5})/);
  const budget = budgetMatch ? Number(budgetMatch[1]) : null;

  let candidates = products.filter((product) => {
    if (product.stock <= 0) return false;
    if (requestedCategory && !wantsBundle && product.category !== requestedCategory) return false;
    if (budget && product.price > budget && !wantsBundle) return false;
    return true;
  });

  if (candidates.length === 0) {
    candidates = products.filter((product) => product.stock > 0);
  }

  return candidates
    .map((product) => ({
      ...product,
      score: scoreProduct(product, text),
      reasons: reasonsFor(product, text)
    }))
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, 3);
}

export function needsClarification(text) {
  const missingBudget = !/\$?\d{3,5}/.test(text);
  const missingUse =
    !/(gaming|design|cad|office|work|home|wifi|student|streaming|accessor|monitor|desktop|laptop)/i.test(text);

  const questions = [];
  if (missingUse) questions.push("What will you mainly use it for?");
  if (missingBudget) questions.push("What budget should I stay within?");

  return {
    shouldClarify: missingBudget || missingUse,
    questions
  };
}
