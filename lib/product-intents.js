const PRODUCT_INTENTS = [
  {
    id: "monitor",
    request: [/\bmonitor\b/i, /\bscreen\b/i, /\bcomputer screen\b/i, /\bdisplay\b/i],
    googleCategories: ["305"],
    category: [/\bmonitors?\b/i, /\bcomputer screens?\b/i, /\bdesktop displays?\b/i],
    include: [
      /\bmonitors?\b/i,
      /\bcomputer screen\b/i,
      /\bdesktop display\b/i,
      /\bfhd\b/i,
      /\bqhd\b/i,
      /\buhd\b/i,
      /\bips\b/i,
      /\bva\b/i,
      /\b\d{2,3}hz\b/i,
      /\b(19|20|21|22|23|24|25|27|28|29|30|32|34|49)(("|”|'')|\s?inch|\s?in)\b/i
    ],
    exclude: [
      /\bscreen protector\b/i,
      /\bprivacy screen\b/i,
      /\bprotector\b/i,
      /\bfilm\b/i,
      /\bstylus\b/i,
      /\bpen\b/i,
      /\bphone\b/i,
      /\btablet\b/i,
      /\bcable\b/i,
      /\badapter\b/i,
      /\badaptor\b/i,
      /\bswitch(er)?\b/i,
      /\bsplitter\b/i,
      /\bdock\b/i,
      /\bhub\b/i
    ]
  },
  {
    id: "cable",
    request: [/\bcable\b/i, /\bcord\b/i, /\blead\b/i],
    category: [/\bcables?\b/i],
    include: [/\bcable\b/i, /\bcord\b/i, /\blead\b/i, /\busb[- ]?c to\b/i, /\btype[- ]?c to\b/i, /\bhdmi to\b/i],
    exclude: [/\bwall charger\b/i, /\bpower adapter\b/i, /\bpower adaptor\b/i, /\bcharging brick\b/i, /\bpower bank\b/i, /\bdock\b/i, /\bhub\b/i]
  },
  {
    id: "charger",
    request: [/\bcharger\b/i, /\bcharging brick\b/i, /\bwall charger\b/i, /\bpower adapter\b/i, /\bpower adaptor\b/i],
    category: [/\bchargers?\b/i, /\bpower adapters?\b/i, /\bpower adaptors?\b/i],
    include: [/\bcharger\b/i, /\bcharging brick\b/i, /\bwall charger\b/i, /\bpower adapter\b/i, /\bpower adaptor\b/i, /\bpd\b/i, /\bgan\b/i],
    exclude: [/\bcable\b/i, /\bcord\b/i, /\blead\b/i]
  },
  {
    id: "power-bank",
    request: [/\bpower bank\b/i, /\bpowerbank\b/i, /\bbattery pack\b/i, /\bportable charger\b/i],
    category: [/\bpower banks?\b/i, /\bportable chargers?\b/i],
    include: [/\bpower bank\b/i, /\bpowerbank\b/i, /\bbattery pack\b/i, /\bportable charger\b/i, /\bmah\b/i],
    exclude: [/\bwall charger\b/i, /\bpower adapter\b/i, /\bpower adaptor\b/i, /\bcable\b/i]
  },
  {
    id: "ram",
    request: [/\bram\b/i, /\bmemory module\b/i, /\bdimm\b/i, /\bsodimm\b/i, /\bddr3\b/i, /\bddr4\b/i, /\bddr5\b/i],
    category: [/\bmemory\b/i, /\bram\b/i],
    include: [/\bram\b/i, /\bmemory module\b/i, /\bdimm\b/i, /\bsodimm\b/i, /\bddr3\b/i, /\bddr4\b/i, /\bddr5\b/i],
    exclude: [/\bflash drive\b/i, /\busb drive\b/i, /\bmemory card\b/i, /\bmicrosd\b/i, /\bsd card\b/i, /\bssd\b/i, /\bhdd\b/i, /\bstorage\b/i]
  },
  {
    id: "storage",
    request: [/\bssd\b/i, /\bhdd\b/i, /\bhard drive\b/i, /\bstorage\b/i, /\bflash drive\b/i, /\bmemory card\b/i, /\bmicrosd\b/i],
    category: [/\bstorage\b/i, /\bsolid state drive\b/i, /\bhard drives?\b/i],
    include: [/\bssd\b/i, /\bhdd\b/i, /\bhard drive\b/i, /\bflash drive\b/i, /\bmemory card\b/i, /\bmicrosd\b/i],
    exclude: [/\bram\b/i, /\bdimm\b/i, /\bsodimm\b/i]
  },
  {
    id: "hub",
    request: [/\bhub\b/i, /\bdock\b/i, /\bdocking station\b/i],
    category: [/\bhubs?\b/i, /\bdocks?\b/i, /\bdocking stations?\b/i],
    include: [/\bhub\b/i, /\bdock\b/i, /\bdocking station\b/i, /\bmultiport\b/i],
    exclude: [/\bcable\b/i, /\bcharger\b/i]
  },
  {
    id: "bag",
    request: [/\bbag\b/i, /\bbackpack\b/i, /\bsleeve\b/i, /\bcase\b/i],
    category: [/\bbags?\b/i, /\bbackpacks?\b/i, /\bsleeves?\b/i, /\bcases?\b/i],
    include: [/\bbag\b/i, /\bbackpack\b/i, /\bsleeve\b/i, /\blaptop case\b/i],
    exclude: [/\bpc case\b/i, /\bchassis\b/i, /\bphone case\b/i]
  },
  {
    id: "graphics-card",
    request: [/\bgraphics card\b/i, /\bgpu\b/i, /\bvideo card\b/i],
    category: [/\bgraphics cards?\b/i, /\bvideo cards?\b/i],
    include: [/\bgraphics card\b/i, /\bgpu\b/i, /\bvideo card\b/i, /\brtx\b/i, /\bgeforce\b/i, /\bradeon\b/i],
    exclude: [/\bcable\b/i, /\badapter\b/i]
  },
  {
    id: "motherboard",
    request: [/\bmotherboard\b/i, /\bmainboard\b/i],
    category: [/\bmotherboards?\b/i],
    include: [/\bmotherboard\b/i, /\bmainboard\b/i, /\bam4\b/i, /\bam5\b/i, /\blga\b/i],
    exclude: [/\bcpu\b/i, /\bprocessor\b/i]
  },
  {
    id: "cpu",
    request: [/\bcpu\b/i, /\bprocessor\b/i, /\bryzen\b/i, /\bcore i[3579]\b/i],
    category: [/\bcpu\b/i, /\bprocessors?\b/i],
    include: [/\bcpu\b/i, /\bprocessor\b/i, /\bryzen\b/i, /\bintel core\b/i],
    exclude: [/\bmotherboard\b/i]
  },
  {
    id: "psu",
    request: [/\bpsu\b/i, /\bpower supply\b/i, /\bpower-supply\b/i],
    category: [/\bpsu\b/i, /\bpower supplies\b/i, /\bpower supply\b/i],
    include: [/\bpsu\b/i, /\bpower supply\b/i, /\b\d{3,4}\s?w\b/i, /\b80\+?\b/i, /\bbronze\b/i, /\bgold\b/i, /\bplatinum\b/i],
    exclude: [/\bpower bank\b/i, /\bcharger\b/i, /\badapter\b/i, /\badaptor\b/i]
  },
  {
    id: "mouse",
    request: [/\bmouse\b/i, /\bmice\b/i],
    category: [/\bmice\b/i, /\bmouse\b/i],
    include: [/\bmouse\b/i, /\bwireless\b/i, /\bbluetooth\b/i, /\b2\.4ghz\b/i, /\brechargeable\b/i],
    exclude: [/\bpad\b/i, /\bmousepad\b/i]
  },
  {
    id: "headset",
    request: [/\bheadset\b/i, /\bheadphones\b/i, /\bheadphone\b/i],
    category: [/\bheadsets?\b/i, /\bheadphones?\b/i],
    include: [/\bheadset\b/i, /\bheadphones?\b/i, /\bwireless\b/i, /\bbluetooth\b/i, /\b2\.4ghz\b/i],
    exclude: [/\bearbuds\b/i, /\bspeaker\b/i]
  }
];

const STOP_WORDS = new Set([
  "i",
  "am",
  "im",
  "i'm",
  "looking",
  "for",
  "need",
  "needs",
  "want",
  "a",
  "an",
  "the",
  "to",
  "my",
  "with",
  "and",
  "or",
  "about",
  "around",
  "under",
  "budget",
  "rand",
  "zar",
  "use",
  "using",
  "just",
  "that",
  "can",
  "is",
  "be",
  "it",
  "this",
  "of",
  "in",
  "on"
]);

function textFrom(product, fields) {
  return fields
    .flatMap((field) => {
      if (field === "category") return product.category || "";
      if (field === "title") return product.name || "";
      if (field === "description") return product.description || "";
      if (field === "tags") return product.tags || [];
      if (field === "specs") return product.specs || [];
      if (field === "collections") return (product.collections || []).map((collection) => collection.title);
      if (field === "metafields") return (product.metafields || []).map((metafield) => `${metafield.key} ${metafield.value}`);
      if (field === "searchText") return product.searchText || "";
      return "";
    })
    .join(" ")
    .toLowerCase();
}

function hasAny(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasGoogleCategory(product, ids = []) {
  const values = [...(product.tags || []), ...(product.specs || []), ...(product.metafields || []).map((metafield) => metafield.value)];
  return values.some((value) => ids.includes(String(value).trim()));
}

function tokensFrom(text) {
  return String(text)
    .toLowerCase()
    .replace(/(\d)\s+(\d{3})/g, "$1$2")
    .replace(/[^a-z0-9+.-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) && !/^\d{2,6}$/.test(token));
}

export function detectRequestedIntents(text) {
  return PRODUCT_INTENTS.filter((intent) => hasAny(text, intent.request));
}

export function productMatchesIntent(product, intent) {
  const categoryText = textFrom(product, ["category", "tags", "collections"]);
  const fullText = textFrom(product, ["searchText", "title", "description", "tags", "specs", "collections", "metafields"]);
  const categoryMatch = hasAny(categoryText, intent.category);
  const googleMatch = hasGoogleCategory(product, intent.googleCategories || []);
  const includeMatch = hasAny(fullText, intent.include);
  const excludeMatch = hasAny(fullText, intent.exclude);

  if (categoryMatch || googleMatch) return true;
  if (excludeMatch) return false;
  return includeMatch;
}

export function productIntentScore(product, text) {
  const requestedIntents = detectRequestedIntents(text);
  if (requestedIntents.length === 0) return 0;

  return requestedIntents.reduce((score, intent) => {
    return score + (productMatchesIntent(product, intent) ? 25 : -40);
  }, 0);
}

export function productMatchesRequestedIntents(product, text) {
  const requestedIntents = detectRequestedIntents(text);
  if (requestedIntents.length === 0) return true;
  return requestedIntents.every((intent) => productMatchesIntent(product, intent));
}

export function requestedIntentNames(text) {
  return detectRequestedIntents(text).map((intent) => intent.id);
}

export function genericCatalogRelevanceScore(product, text) {
  const requestTokens = tokensFrom(text);
  if (requestTokens.length === 0) return 0;

  const categoryText = textFrom(product, ["category", "collections"]).toLowerCase();
  const taxonomyText = textFrom(product, ["tags", "metafields", "specs"]).toLowerCase();
  const titleText = textFrom(product, ["title"]).toLowerCase();
  const descriptionText = textFrom(product, ["description", "searchText"]).toLowerCase();
  let score = 0;

  for (const token of requestTokens) {
    if (categoryText.includes(token)) score += 8;
    if (taxonomyText.includes(token)) score += 5;
    if (titleText.includes(token)) score += 4;
    if (descriptionText.includes(token)) score += 1;
  }

  const normalizedRequest = requestTokens.join(" ");
  if (categoryText.includes(normalizedRequest)) score += 20;
  if (titleText.includes(normalizedRequest)) score += 10;
  if (taxonomyText.includes(normalizedRequest)) score += 10;

  return score;
}
