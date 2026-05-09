function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0
  }).format(value);
}

function productText(product) {
  return [
    product.searchText,
    product.name,
    product.category,
    product.vendor,
    product.description,
    ...(product.specs || []),
    ...(product.tags || []),
    ...(product.collections || []).map((collection) => collection.title),
    ...(product.metafields || []).map((metafield) => `${metafield.key} ${metafield.value}`)
  ]
    .join(" ")
    .toLowerCase();
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isMonitorAccessory(product) {
  const text = productText(product);
  return includesAny(text, [
    /\bcable\b/,
    /\badapter\b/,
    /\badaptor\b/,
    /\bconverter\b/,
    /\bswitch\b/,
    /\bswitcher\b/,
    /\bsplitter\b/,
    /\bkvm\b/,
    /\bselector\b/,
    /\bextender\b/,
    /\brepeater\b/,
    /\bdongle\b/,
    /\bdock\b/,
    /\bhub\b/,
    /\bmount\b/,
    /\bbracket\b/,
    /\bstand\b/,
    /\bdisplayport\b.*\bcable\b/,
    /\bhdmi\b.*\bcable\b/,
    /\bhdmi\b.*\bswitch/,
    /\bdp\b.*\bcable\b/,
    /\blaptop skin\b/,
    /\bbackpack\b/,
    /\bmultiplug\b/,
    /\bextension cord\b/,
    /\bmotherboard\b/,
    /\bgraphics card\b/,
    /\bmicrophone\b/,
    /\bssd\b/,
    /\bhdd\b/
  ]);
}

function isMonitorProduct(product) {
  const text = productText(product);
  const strongMonitorSignals = [
    /\bmonitor\b/,
    /\bscreen\b/,
    /\bdesktop monitor\b/,
    /\bgaming monitor\b/,
    /\bcomputer monitor\b/,
    /\bcomputer screen\b/
  ];
  const panelSignals = [
    /\bfhd\b/,
    /\bqhd\b/,
    /\buhd\b/,
    /\bcurved\b/,
    /\bled\b/,
    /\blcd\b/,
    /\bips\b/,
    /\bva\b/,
    /\brefresh rate\b/,
    /\b75hz\b/,
    /\b100hz\b/,
    /\b120hz\b/,
    /\b144hz\b/,
    /\b165hz\b/,
    /\bvesa\b/,
    /\bhdmi\b.*\bmonitor\b/,
    /\bvga\b.*\bmonitor\b/
  ];
  const sizeSignal = /\b(21|22|23|24|25|27|28|29|30|32|34)(("|”|'')|\s?inch|\s?in|\s?cm)?\b/;
  const categorySignal = /\b(monitors?|computer screens?|desktop displays?)\b/.test(String(product.category || "").toLowerCase());

  if (isMonitorAccessory(product)) return false;
  if (categorySignal) return true;
  if (includesAny(text, strongMonitorSignals)) return true;
  return sizeSignal.test(text) && includesAny(text, panelSignals);
}

function normalizePreferredBrands(preferredBrands = {}) {
  return Object.entries(preferredBrands || {}).reduce((rules, [rawCategory, rawBrands]) => {
    const category = String(rawCategory).trim().toLowerCase();
    const brands = Array.isArray(rawBrands) ? rawBrands : [rawBrands];
    const normalizedBrands = brands.map((brand) => String(brand).trim().toLowerCase()).filter(Boolean);
    if (category && normalizedBrands.length > 0) {
      rules[category] = normalizedBrands;
    }
    return rules;
  }, {});
}

function preferredBrandMatches(product, text, preferredBrands = {}) {
  const terms = text.toLowerCase();
  const searchableProductText = productText(product);
  const rules = normalizePreferredBrands(preferredBrands);
  const matches = [];

  for (const [category, brands] of Object.entries(rules)) {
    const requestMatchesCategory = terms.includes(category) || searchableProductText.includes(category);
    if (!requestMatchesCategory) continue;

    const matchedBrand = brands.find((brand) => searchableProductText.includes(brand));
    if (matchedBrand) {
      matches.push({
        category,
        brand: matchedBrand
      });
    }
  }

  return matches;
}

function wantsRam(text) {
  return /\b(ram|memory|dimm|sodimm|ddr3|ddr4|ddr5)\b/i.test(text);
}

function ramCapacityRequest(text) {
  return text.toLowerCase().match(/\b(4|8|16|24|32|64|128)\s?gb\b/)?.[1] || null;
}

function isRamProduct(product) {
  const text = productText(product);
  const ramSignals = [/\bram\b/, /\bmemory module\b/, /\bdimm\b/, /\bsodimm\b/, /\bddr3\b/, /\bddr4\b/, /\bddr5\b/];
  const storageSignals = [
    /\bflash drive\b/,
    /\bflash disk\b/,
    /\busb drive\b/,
    /\bmemory card\b/,
    /\bmicrosd\b/,
    /\bsd card\b/,
    /\bssd\b/,
    /\bhdd\b/,
    /\bstorage\b/
  ];
  return ramSignals.some((signal) => signal.test(text)) && !storageSignals.some((signal) => signal.test(text));
}

function isDesktopRamProduct(product) {
  const text = productText(product);
  return isRamProduct(product) && (/\budimm\b|\bdimm\b|\bdesktop\b/.test(text) || !/\bsodimm\b|\blaptop\b/.test(text));
}

export function isRelevantProductForRequest(product, text) {
  const terms = text.toLowerCase();
  const wantsScreen = terms.includes("screen") || terms.includes("display") || terms.includes("monitor");
  const ramRequest = wantsRam(text);

  if (wantsScreen && !isMonitorProduct(product)) return false;
  if (ramRequest && !isRamProduct(product)) return false;
  if (ramRequest && terms.includes("desktop") && /\bsodimm\b|\blaptop\b/.test(productText(product))) return false;
  if (ramRequest && terms.includes("ddr4") && !productText(product).includes("ddr4")) return false;

  return true;
}

export function scoreProduct(product, text, preferredBrands = {}) {
  const terms = text.toLowerCase();
  const searchableProductText = productText(product);
  let score = 0;

  for (const tag of product.tags) {
    if (terms.includes(tag)) score += 3;
  }

  if (terms.includes("laptop") && product.category === "laptop") score += 5;
  if (terms.includes("desktop") && product.category === "desktop") score += 5;
  if ((terms.includes("monitor") || terms.includes("screen") || terms.includes("display")) && isMonitorProduct(product)) score += 18;
  if ((terms.includes("monitor") || terms.includes("screen") || terms.includes("display")) && !isMonitorProduct(product)) score -= 20;
  if (terms.includes("accessor") && product.category === "accessory") score += 5;
  if (terms.includes("gaming") && product.tags.includes("performance")) score += 3;
  if ((terms.includes("design") || terms.includes("cad")) && product.tags.includes("design")) score += 4;
  if ((terms.includes("office") || terms.includes("work")) && (product.tags.includes("office") || searchableProductText.includes("monitor"))) score += 4;
  if ((terms.includes("home") || terms.includes("wifi")) && product.tags.includes("home")) score += 4;
  if (terms.includes("gaming") && searchableProductText.includes("gaming")) score += 5;
  if (terms.match(/\b2[4-9]\b|\b3[0-9]\b/) && searchableProductText.match(/\b2[4-9](\.| |-)?(inch|in|\"|”)?|\b3[0-9](\.| |-)?(inch|in|\"|”)?/)) score += 5;
  if (wantsRam(text) && isRamProduct(product)) score += 25;
  if (wantsRam(text) && !isRamProduct(product)) score -= 35;
  if (terms.includes("desktop") && wantsRam(text) && isDesktopRamProduct(product)) score += 10;
  if (terms.includes("desktop") && wantsRam(text) && /\bsodimm\b|\blaptop\b/.test(searchableProductText)) score -= 18;
  if (terms.includes("rgb") && searchableProductText.includes("rgb")) score += 12;
  if (terms.includes("rgb") && wantsRam(text) && !searchableProductText.includes("rgb")) score -= 5;
  if (terms.includes("ddr4") && searchableProductText.includes("ddr4")) score += 12;
  if (terms.includes("ddr4") && wantsRam(text) && !searchableProductText.includes("ddr4")) score -= 20;

  const requestedCapacity = ramCapacityRequest(text);
  if (requestedCapacity && wantsRam(text)) {
    const capacityPattern = new RegExp(`\\\\b${requestedCapacity}\\\\s?gb\\\\b`, "i");
    if (capacityPattern.test(searchableProductText)) score += 18;
    if (!capacityPattern.test(searchableProductText)) score -= 10;
  }

  score += preferredBrandMatches(product, text, preferredBrands).length * 12;

  const budgetMatch = terms.match(/\$?(\d{3,5})/);
  if (budgetMatch) {
    const budget = Number(budgetMatch[1]);
    if (product.price <= budget) score += 4;
    if (product.price > budget) score -= 5;
  }

  if (product.stock > 0) score += 2;

  return score;
}

export function reasonsFor(product, text, preferredBrands = {}) {
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
  if (wantsRam(text) && isRamProduct(product)) {
    reasons.push("Matches a RAM/memory-module request, not removable storage.");
  }
  if (terms.includes("rgb") && productText(product).includes("rgb")) {
    reasons.push("Includes RGB lighting as requested.");
  }
  if (product.stock > 0) {
    reasons.push(`Available now with ${product.stock} in stock.`);
  }
  for (const match of preferredBrandMatches(product, text, preferredBrands)) {
    reasons.push(`Preferred brand for ${match.category} requests.`);
  }

  return reasons.slice(0, 3);
}

export function recommendProducts(products, text, options = {}) {
  const preferredBrands = options.preferredBrands || {};
  const terms = text.toLowerCase();
  const requestedCategory = ["laptop", "desktop", "monitor"].find((category) => terms.includes(category));
  const wantsScreen = terms.includes("screen") || terms.includes("display") || terms.includes("monitor");
  const ramRequest = wantsRam(text);
  const wantsBundle = /(setup|bundle|accessor|complete)/i.test(text);
  const budgetMatch = terms.match(/\$?(\d{3,5})/);
  const budget = budgetMatch ? Number(budgetMatch[1]) : null;

  let candidates = products.filter((product) => {
    if (product.stock <= 0) return false;
    if (requestedCategory && !wantsBundle && product.category !== requestedCategory) return false;
    if (!wantsBundle && !isRelevantProductForRequest(product, text)) return false;
    if (budget && product.price > budget && !wantsBundle) return false;
    return true;
  });

  if (candidates.length === 0 && wantsScreen) {
    candidates = products.filter((product) => product.stock > 0 && isMonitorProduct(product));
  }

  if (candidates.length === 0 && ramRequest) {
    candidates = products.filter((product) => product.stock > 0 && isRamProduct(product));
  }

  if (candidates.length === 0 && !wantsScreen && !ramRequest) {
    candidates = products.filter((product) => product.stock > 0);
  }

  return candidates
    .map((product) => ({
      ...product,
      score: scoreProduct(product, text, preferredBrands),
      reasons: reasonsFor(product, text, preferredBrands)
    }))
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, options.limit || 3);
}

export function needsClarification(text) {
  const missingBudget = !/\$?\d{3,5}/.test(text);
  const missingUse =
    !/(gaming|design|cad|office|work|home|wifi|student|streaming|accessor|cable|hub|adapter|adaptor|bag|monitor|screen|display|desktop|laptop|ram|memory|dimm|sodimm|ddr3|ddr4|ddr5)/i.test(text);

  const questions = [];
  if (missingUse) questions.push("What will you mainly use it for?");
  if (missingBudget) questions.push("What budget should I stay within?");

  return {
    shouldClarify: missingBudget || missingUse,
    questions
  };
}
