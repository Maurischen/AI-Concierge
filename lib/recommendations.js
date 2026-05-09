import {
  detectRequestedIntents,
  genericCatalogRelevanceScore,
  productIntentScore,
  productMatchesRequestedIntents,
  requestedIntentNames
} from "./product-intents.js";

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
    /\bpen\b/,
    /\bstylus\b/,
    /\bballpoint\b/,
    /\bphone\b/,
    /\bmobile phone\b/,
    /\bscreen protector\b/,
    /\bprivacy screen\b/,
    /\bprotector\b/,
    /\bfilm\b/,
    /\btablet\b/,
    /\bipad\b/,
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

function hasGoogleProductCategory(product, categoryId) {
  const expected = String(categoryId);
  return [
    ...(product.tags || []),
    ...(product.specs || []),
    ...(product.metafields || []).map((metafield) => metafield.value)
  ].some((value) => String(value).trim() === expected);
}

function hasAuthoritativeMonitorSignal(product) {
  const category = String(product.category || "").toLowerCase();
  const title = String(product.name || "").toLowerCase();
  const tags = (product.tags || []).map((tag) => String(tag).toLowerCase());
  const collections = (product.collections || []).map((collection) => String(collection.title || "").toLowerCase());

  return (
    /\bmonitors?\b/.test(category) ||
    /\bmonitors?\b/.test(title) ||
    /\bcomputer screen\b/.test(title) ||
    /\bdesktop display\b/.test(title) ||
    tags.some((tag) => tag === "monitors" || tag === "monitor" || tag.includes("monitors/projectors")) ||
    collections.some((collection) => /\bmonitors?\b/.test(collection)) ||
    hasGoogleProductCategory(product, 305)
  );
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
  const sizeSignal = /\b(21|22|23|24|25|27|28|29|30|32|34)(("|”|'')|\s?inch|\s?in)\b/;
  const monitorCategorySignal = /\b(monitors?|computer screens?|desktop displays?)\b/.test(String(product.category || "").toLowerCase());
  const monitorCollectionSignal = (product.collections || []).some((collection) =>
    /\b(monitors?|computer screens?|desktop displays?)\b/i.test(collection.title || "")
  );
  const titleSignal = /\b(monitors?|computer screen|desktop display)\b/i.test(product.name || "");

  if (hasAuthoritativeMonitorSignal(product)) return true;
  if (isMonitorAccessory(product)) return false;
  if (monitorCategorySignal || monitorCollectionSignal || titleSignal) return true;
  return sizeSignal.test(text) && includesAny(text, panelSignals);
}

function requestedMonitorSize(text) {
  const terms = text.toLowerCase();
  if (!/\b(screen|monitor|display|computer screen)\b/.test(terms)) return null;

  const explicitSize = terms.match(/\b(1[5-9]|2[0-9]|3[0-9]|4[0-9])(\.\d+)?\s?(\"|”|'|inch|inches|in)\b/);
  if (explicitSize) return Number(`${explicitSize[1]}${explicitSize[2] || ""}`);

  const nearbySize = terms.match(/\b(1[5-9]|2[0-9]|3[0-9]|4[0-9])(\.\d+)?\s?(screen|monitor|display)\b/);
  if (nearbySize) return Number(`${nearbySize[1]}${nearbySize[2] || ""}`);

  return null;
}

function monitorSizeAllowsLarger(text) {
  return /\b(at least|minimum|min\.?|not smaller than|no smaller than|or bigger|or larger|larger than|bigger than|and up|plus)\b/i.test(text);
}

function productMonitorSize(product) {
  const text = productText(product);
  const matches = [...text.matchAll(/\b(1[5-9]|2[0-9]|3[0-9]|4[0-9])(\.\d+)?\s?(\"|”|'|inch|inches|in)\b/g)];
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(`${match[1]}${match[2] || ""}`)));
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

function productBrandText(product) {
  return [product.vendor, product.name, ...(product.tags || [])].join(" ").toLowerCase();
}

function brandCandidateLooksUseful(brand) {
  const normalized = brand.toLowerCase().trim();
  if (normalized.length < 2 || normalized.length > 35) return false;
  return ![
    "new",
    "msa",
    "mwc",
    "tvr",
    "loc",
    "stock",
    "solid state",
    "graphics card",
    "motherboard",
    "monitor",
    "monitors",
    "laptop",
    "desktop",
    "cable",
    "charger",
    "power bank",
    "bag",
    "case",
    "hub",
    "adapter",
    "adaptor",
    "keyboard",
    "mouse",
    "gaming",
    "office",
    "accessories",
    "components",
    "automated collection",
    "all products",
    "new arrivals"
  ].some((blocked) => normalized === blocked || normalized.startsWith(`${blocked} `));
}

function catalogBrandCandidates(products) {
  const candidates = [];

  for (const product of products) {
    if (product.vendor) candidates.push(String(product.vendor).trim());

    const titleWords = String(product.name || "")
      .split(/\s+/)
      .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
      .filter(Boolean);
    if (titleWords[0]) candidates.push(titleWords[0]);
    if (titleWords[0] && titleWords[1]) candidates.push(`${titleWords[0]} ${titleWords[1]}`);

    for (const tag of product.tags || []) {
      const cleanTag = String(tag).trim();
      if (/^[a-z0-9][a-z0-9 -]{1,34}$/i.test(cleanTag)) candidates.push(cleanTag);
    }
  }

  return [...new Set(candidates.filter(brandCandidateLooksUseful))].sort((a, b) => b.length - a.length);
}

function extractRequestedBrands(products, text) {
  const terms = text.toLowerCase();
  const explicitPreferenceText =
    terms.match(/\b(?:prefer|preferred|preference|brand preference|only|specific brand|looking for)\b(.{0,120})/)?.[0] || terms;
  const brands = catalogBrandCandidates(products);

  const catalogBrands = brands.filter((brand) => {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(explicitPreferenceText);
  });

  return [...new Set(catalogBrands)];
}

function productMatchesRequestedBrands(product, requestedBrands = []) {
  if (requestedBrands.length === 0) return true;
  const brandText = productBrandText(product);
  return requestedBrands.some((brand) => brandText.includes(brand.toLowerCase()));
}

function wantsRam(text) {
  return /\b(ram|memory|dimm|sodimm|ddr3|ddr4|ddr5)\b/i.test(text);
}

function ramCapacityRequest(text) {
  return text.toLowerCase().match(/\b(4|8|16|24|32|64|128)\s?gb\b/)?.[1] || null;
}

function requestedStorageCapacityGb(text) {
  const terms = text.toLowerCase().replace(/(\d)\s+(\d{3})/g, "$1$2");
  const tbMatch = terms.match(/\b(\d+(\.\d+)?)\s?tb\b/);
  if (tbMatch) return Number(tbMatch[1]) * 1000;
  const gbMatch = terms.match(/\b(\d{3,5})\s?gb\b/);
  if (gbMatch) return Number(gbMatch[1]);
  return null;
}

function productStorageCapacityGb(product) {
  const text = productText(product).replace(/(\d)\s+(\d{3})/g, "$1$2");
  const capacities = [];
  for (const match of text.matchAll(/\b(\d+(\.\d+)?)\s?tb\b/g)) {
    capacities.push(Number(match[1]) * 1000);
  }
  for (const match of text.matchAll(/\b(\d{3,5})\s?gb\b/g)) {
    capacities.push(Number(match[1]));
  }
  return capacities.length > 0 ? Math.max(...capacities) : null;
}

function storageCapacityMatches(product, text) {
  const requestedCapacity = requestedStorageCapacityGb(text);
  if (!requestedCapacity) return true;
  const productCapacity = productStorageCapacityGb(product);
  if (!productCapacity) return false;
  return Math.abs(productCapacity - requestedCapacity) <= Math.max(64, requestedCapacity * 0.05);
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

function wantsCable(text) {
  return /\b(cable|cord|lead)\b/i.test(text);
}

function hasProductNeed(text) {
  return /\b(power bank|powerbank|battery pack|portable charger|charger|cable|cord|lead|hub|dock|adapter|adaptor|bag|backpack|sleeve|case|monitor|screen|display|desktop|laptop|ram|memory|dimm|sodimm|ddr3|ddr4|ddr5|ssd|hdd|hard drive|flash drive|graphics card|gpu|video card|motherboard|mainboard|cpu|processor|keyboard|mouse|steering wheel|racing wheel|wheel|headset|speaker|microphone|webcam|router|switch|access point|ups|printer|toner|cartridge)\b/i.test(text);
}

function budgetIsOptional(text) {
  return /\b(i don'?t know|not sure|no budget|without a budget|any budget|show me|what is in stock|what's in stock|in stock|available|browse|options)\b/i.test(text);
}

function isCableProduct(product) {
  const text = productText(product);
  const cableSignals = [
    /\bcable\b/,
    /\bcord\b/,
    /\blead\b/,
    /\btype[- ]?c to\b/,
    /\busb[- ]?c to\b/,
    /\blightning to\b/,
    /\bhdmi to\b/,
    /\bdisplayport to\b/,
    /\b\d+(\.\d+)?m\b/,
    /\b\d+(\.\d+)? metre\b/,
    /\b\d+(\.\d+)? meter\b/
  ];
  const nonCableSignals = [
    /\bcharger\b/,
    /\bwall charger\b/,
    /\bpower adapter\b/,
    /\bpower adaptor\b/,
    /\bcar charger\b/,
    /\bcharging brick\b/,
    /\bplug\b/,
    /\bpower bank\b/,
    /\bhub\b/,
    /\bdock\b/,
    /\bdongle\b/
  ];

  if (!includesAny(text, cableSignals)) return false;
  if (includesAny(text, nonCableSignals) && !/\bcable\b/.test(text)) return false;
  return true;
}

function isStorageRequest(text) {
  return /\b(ssd|hdd|hard drive|storage|m\.?2|nvme|sata drive|solid state drive)\b/i.test(text);
}

function wantsStorageDrive(text) {
  return /\b(ssd|hdd|hard drive|solid state drive|drive)\b/i.test(text) && !/\b(enclosure|case|caddy|adapter|adaptor|dock|reader)\b/i.test(text);
}

function isStorageAccessory(product) {
  const text = productText(product);
  return /\b(enclosure|case|caddy|adapter|adaptor|dock|reader|converter|housing|tool-free case)\b/.test(text);
}

const accessoryNouns = [
  "accessory",
  "accessories",
  "adapter",
  "adaptor",
  "cable",
  "case",
  "caddy",
  "cover",
  "dock",
  "enclosure",
  "housing",
  "kit",
  "mount",
  "protector",
  "reader",
  "screen protector",
  "sleeve",
  "stand",
  "switch",
  "converter",
  "bracket",
  "holder"
];

const productHeadNouns = [
  "ssd",
  "hdd",
  "hard drive",
  "drive",
  "monitor",
  "screen",
  "display",
  "laptop",
  "desktop",
  "motherboard",
  "mainboard",
  "cpu",
  "processor",
  "ram",
  "memory",
  "graphics card",
  "gpu",
  "keyboard",
  "mouse",
  "printer",
  "router",
  "switch",
  "ups",
  "power bank",
  "charger",
  "headset",
  "speaker",
  "microphone",
  "webcam",
  "steering wheel",
  "racing wheel",
  "bag",
  "backpack"
];

function requestedProductNouns(text) {
  const terms = text.toLowerCase();
  return productHeadNouns.filter((noun) => new RegExp(`\\b${noun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(terms));
}

function isExplicitAccessoryRequest(text) {
  return /\b(enclosure|case|cover|sleeve|protector|mount|stand|bracket|adapter|adaptor|cable|dock|reader|caddy|housing|kit|holder|accessory|accessories)\b/i.test(text);
}

function accessoryConflict(product, text) {
  if (isExplicitAccessoryRequest(text)) return null;
  const requestedNouns = requestedProductNouns(text);
  if (requestedNouns.length === 0) return null;

  const productName = String(product.name || "").toLowerCase();
  const fullText = productText(product);
  const accessoryPattern = new RegExp(`\\b(${accessoryNouns.map((noun) => noun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
  if (!accessoryPattern.test(productName)) return null;

  const conflictingNoun = requestedNouns.find((noun) => new RegExp(`\\b${noun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(fullText));
  return conflictingNoun || null;
}

function hasStorageFormat(text) {
  return /\b(2\.5|3\.5|m\.?2|nvme|sata|external|portable|internal|pcie)\b/i.test(text);
}

function isMotherboardRequest(text) {
  return /\b(motherboard|mainboard)\b/i.test(text);
}

function hasMotherboardCompatibility(text) {
  return /\b(am4|am5|lga\s?\d+|intel|amd|ddr4|ddr5|atx|m-atx|matx|micro-atx|itx|mini-itx)\b/i.test(text);
}

function isCpuRequest(text) {
  return /\b(cpu|processor|ryzen|core i[3579]|intel core)\b/i.test(text);
}

function hasCpuCompatibility(text) {
  return /\b(am4|am5|lga\s?\d+|intel|amd|motherboard|board|socket)\b/i.test(text);
}

function isPsuRequest(text) {
  return /\b(psu|power supply|power-supply)\b/i.test(text);
}

function hasPsuCompatibility(text) {
  return /\b(\d{3,4}\s?w|watt|watts|atx|sfx|modular|non-modular|bronze|gold|platinum)\b/i.test(text);
}

export function isRelevantProductForRequest(product, text) {
  const terms = text.toLowerCase();
  const wantsScreen = terms.includes("screen") || terms.includes("display") || terms.includes("monitor");
  const ramRequest = wantsRam(text);
  const cableRequest = wantsCable(text);
  const monitorSize = requestedMonitorSize(text);

  if (wantsScreen && !isMonitorProduct(product)) return false;
  if (wantsScreen && monitorSize) {
    const productSize = productMonitorSize(product);
    if (!productSize) return false;
    if (productSize < monitorSize - 0.3) return false;
    if (!monitorSizeAllowsLarger(text) && productSize > monitorSize + 1) return false;
  }
  if (ramRequest && !isRamProduct(product)) return false;
  if (ramRequest && terms.includes("desktop") && /\bsodimm\b|\blaptop\b/.test(productText(product))) return false;
  if (ramRequest && terms.includes("ddr4") && !productText(product).includes("ddr4")) return false;
  if (cableRequest && !isCableProduct(product)) return false;
  if (accessoryConflict(product, text)) return false;
  if (isStorageRequest(text) && wantsStorageDrive(text) && isStorageAccessory(product)) return false;
  if (isStorageRequest(text) && !storageCapacityMatches(product, text)) return false;
  if (!productMatchesRequestedIntents(product, text)) return false;
  if (detectRequestedIntents(text).length === 0 && genericCatalogRelevanceScore(product, text) < 8) return false;

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
  const monitorSize = requestedMonitorSize(text);
  const productSize = productMonitorSize(product);
  if (monitorSize && productSize) {
    if (productSize >= monitorSize - 0.3) score += Math.max(0, 20 - Math.abs(productSize - monitorSize) * 4);
    if (productSize < monitorSize - 0.3) score -= 30;
    if (!monitorSizeAllowsLarger(text) && productSize > monitorSize + 1) score -= 50;
  }
  if (terms.includes("accessor") && product.category === "accessory") score += 5;
  if (accessoryConflict(product, text)) score -= 80;
  if (terms.includes("gaming") && product.tags.includes("performance")) score += 3;
  if ((terms.includes("design") || terms.includes("cad")) && product.tags.includes("design")) score += 4;
  if ((terms.includes("office") || terms.includes("work")) && (product.tags.includes("office") || searchableProductText.includes("monitor"))) score += 4;
  if ((terms.includes("home") || terms.includes("wifi")) && product.tags.includes("home")) score += 4;
  if (terms.includes("gaming") && searchableProductText.includes("gaming")) score += 5;
  if (terms.match(/\b2[4-9]\b|\b3[0-9]\b/) && searchableProductText.match(/\b2[4-9](\.| |-)?(inch|in|\"|”)?|\b3[0-9](\.| |-)?(inch|in|\"|”)?/)) score += 5;
  if (wantsRam(text) && isRamProduct(product)) score += 25;
  if (wantsRam(text) && !isRamProduct(product)) score -= 35;
  if (wantsCable(text) && isCableProduct(product)) score += 25;
  if (wantsCable(text) && !isCableProduct(product)) score -= 35;
  if (terms.includes("usb c") || terms.includes("usb-c") || terms.includes("type c") || terms.includes("type-c")) {
    if (searchableProductText.match(/\busb[- ]?c\b|\btype[- ]?c\b/)) score += 12;
    if (wantsCable(text) && !searchableProductText.match(/\busb[- ]?c\b|\btype[- ]?c\b/)) score -= 8;
  }
  if (terms.includes("desktop") && wantsRam(text) && isDesktopRamProduct(product)) score += 10;
  if (terms.includes("desktop") && wantsRam(text) && /\bsodimm\b|\blaptop\b/.test(searchableProductText)) score -= 18;
  if (terms.includes("rgb") && searchableProductText.includes("rgb")) score += 12;
  if (terms.includes("rgb") && wantsRam(text) && !searchableProductText.includes("rgb")) score -= 5;
  if (terms.includes("ddr4") && searchableProductText.includes("ddr4")) score += 12;
  if (terms.includes("ddr4") && wantsRam(text) && !searchableProductText.includes("ddr4")) score -= 20;
  if (isStorageRequest(text)) {
    if (wantsStorageDrive(text) && isStorageAccessory(product)) score -= 60;
    if (storageCapacityMatches(product, text)) score += 18;
    if (!storageCapacityMatches(product, text)) score -= 45;
    if (terms.includes("nvme") && searchableProductText.includes("nvme")) score += 14;
    if (terms.includes("nvme") && !searchableProductText.includes("nvme")) score -= 20;
    if (terms.includes("sata") && searchableProductText.includes("sata")) score += 14;
    if (terms.includes("sata") && !searchableProductText.includes("sata")) score -= 14;
    if (terms.includes("m.2") || terms.includes("m2")) {
      if (searchableProductText.match(/\bm\.?2\b/)) score += 14;
      if (!searchableProductText.match(/\bm\.?2\b/)) score -= 20;
    }
  }

  const requestedCapacity = ramCapacityRequest(text);
  if (requestedCapacity && wantsRam(text)) {
    const capacityPattern = new RegExp(`\\\\b${requestedCapacity}\\\\s?gb\\\\b`, "i");
    if (capacityPattern.test(searchableProductText)) score += 18;
    if (!capacityPattern.test(searchableProductText)) score -= 10;
  }
  score += productIntentScore(product, text);
  score += genericCatalogRelevanceScore(product, text);

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

export function reasonsFor(product, text, preferredBrands = {}, requestedBrands = []) {
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
  if (wantsCable(text) && isCableProduct(product)) {
    reasons.push("Matches a cable request, not a charger or power adapter.");
  }
  if (isStorageRequest(text) && storageCapacityMatches(product, text)) {
    reasons.push("Matches the requested storage capacity and product type.");
  }
  const intentNames = requestedIntentNames(text);
  if (intentNames.length > 0 && productMatchesRequestedIntents(product, text)) {
    reasons.push(`Matches the requested product type: ${intentNames.join(", ")}.`);
  }
  if (intentNames.length === 0 && genericCatalogRelevanceScore(product, text) >= 8) {
    reasons.push("Matches product category, tags, or catalog details from Shopify.");
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
  const matchedRequestedBrand = requestedBrands.find((brand) => productMatchesRequestedBrands(product, [brand]));
  if (matchedRequestedBrand) {
    reasons.push(`Matches your requested brand: ${matchedRequestedBrand}.`);
  }

  return reasons.slice(0, 3);
}

export function recommendProducts(products, text, options = {}) {
  const preferredBrands = options.preferredBrands || {};
  const requestedBrands = extractRequestedBrands(products, text);
  const terms = text.toLowerCase();
  const requestedCategory = !isExplicitAccessoryRequest(text) && ["laptop", "desktop", "monitor"].find((category) => terms.includes(category));
  const wantsScreen = terms.includes("screen") || terms.includes("display") || terms.includes("monitor");
  const ramRequest = wantsRam(text);
  const cableRequest = wantsCable(text);
  const hasExplicitIntent = detectRequestedIntents(text).length > 0;
  const wantsBundle = /(setup|bundle|accessor|complete)/i.test(text);
  const budgetMatch = terms.match(/\$?(\d{3,5})/);
  const budget = budgetMatch ? Number(budgetMatch[1]) : null;

  let candidates = products.filter((product) => {
    if (product.stock <= 0) return false;
    if (requestedCategory && !wantsBundle && !String(product.category || "").toLowerCase().includes(requestedCategory)) return false;
    if (!wantsBundle && !isRelevantProductForRequest(product, text)) return false;
    if (!productMatchesRequestedBrands(product, requestedBrands)) return false;
    if (budget && product.price > budget && !wantsBundle) return false;
    return true;
  });

  if (candidates.length === 0 && requestedBrands.length > 0) {
    candidates = products.filter((product) => {
      if (product.stock <= 0) return false;
      if (!wantsBundle && !isRelevantProductForRequest(product, text)) return false;
      if (budget && product.price > budget && !wantsBundle) return false;
      return true;
    });
  }

  if (candidates.length === 0 && wantsScreen) {
    const monitorSize = requestedMonitorSize(text);
    candidates = products.filter((product) => {
      if (product.stock <= 0 || !isMonitorProduct(product)) return false;
      if (!monitorSize || monitorSizeAllowsLarger(text)) return true;
      const productSize = productMonitorSize(product);
      return productSize && productSize >= monitorSize - 0.3 && productSize <= monitorSize + 1;
    });
  }

  if (candidates.length === 0 && ramRequest) {
    candidates = products.filter((product) => product.stock > 0 && isRamProduct(product));
  }

  if (candidates.length === 0 && cableRequest) {
    candidates = products.filter((product) => product.stock > 0 && isCableProduct(product));
  }

  if (candidates.length === 0 && !wantsScreen && !ramRequest && !cableRequest && !hasExplicitIntent) {
    candidates = products.filter((product) => product.stock > 0 && !accessoryConflict(product, text) && genericCatalogRelevanceScore(product, text) >= 8);
  }

  return candidates
    .map((product) => ({
      ...product,
      score: scoreProduct(product, text, preferredBrands) + (productMatchesRequestedBrands(product, requestedBrands) ? 20 : 0),
      reasons: reasonsFor(product, text, preferredBrands, requestedBrands)
    }))
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, options.limit || 3);
}

export function needsClarification(text) {
  const missingBudget = !/\$?\d{3,5}/.test(text) && !budgetIsOptional(text);
  const missingUse = !/(gaming|design|cad|office|work|home|wifi|student|streaming|charging|charge|travel|backup|portable)/i.test(text) && !hasProductNeed(text);

  const questions = [];
  if (missingUse) questions.push("What will you mainly use it for?");
  if (missingBudget) questions.push("What budget should I stay within?");

  return {
    shouldClarify: missingBudget || missingUse,
    questions
  };
}

export function getQualificationQuestions(text) {
  const questions = [];

  if (isStorageRequest(text) && !hasStorageFormat(text)) {
    questions.push("Do you need a 2.5-inch SATA drive, an M.2 NVMe drive, or an external/portable drive?");
  }

  if (isMotherboardRequest(text) && !hasMotherboardCompatibility(text)) {
    questions.push("Which CPU socket and board size do you need, for example AM4/AM5/LGA, ATX/M-ATX/ITX, and DDR4 or DDR5?");
  }

  if (isCpuRequest(text) && !hasCpuCompatibility(text)) {
    questions.push("Which motherboard socket/platform are you using, for example AM4, AM5, or an Intel LGA socket?");
  }

  if (isPsuRequest(text) && !hasPsuCompatibility(text)) {
    questions.push("What wattage and form factor do you need, for example 550W/650W/750W and ATX or SFX?");
  }

  return questions;
}
