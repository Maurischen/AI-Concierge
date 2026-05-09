function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function locationKey(location) {
  return location?.id || normalizeText([location?.name, location?.address?.city].filter(Boolean).join(" "));
}

function availableQuantity(location) {
  return Number(location?.available || 0);
}

function productLocations(product) {
  const selectedVariant = (product.variants || []).find((variant) => variant.id === product.variantId);
  const selectedLocations = selectedVariant?.inventoryByLocation || [];
  const variantLocations = selectedLocations.length > 0 ? selectedLocations : (product.variants || []).flatMap((variant) => variant.inventoryByLocation || []);
  return uniqBy(variantLocations, locationKey).filter(
    (location) => availableQuantity(location) > 0 && location.isActive !== false && location.fulfillsOnlineOrders !== false
  );
}

function allCatalogLocations(products) {
  return uniqBy(products.flatMap(productLocations), locationKey);
}

function locationSearchParts(location) {
  return [
    location.name,
    location.address?.city,
    location.address?.province,
    location.address?.zip,
    location.address?.country,
    location.address?.address1
  ].filter(Boolean);
}

function locationMatchesText(location, text) {
  const terms = normalizeText(text);
  return locationSearchParts(location).some((part) => {
    const normalizedPart = normalizeText(part);
    return normalizedPart.length >= 3 && terms.includes(normalizedPart);
  });
}

function findRequestedLocation(products, text) {
  if (!/\b(location|store|branch|shop|available|stock|pickup|collect|collection|in|at|near)\b/i.test(text)) return null;
  const matches = allCatalogLocations(products)
    .filter((location) => locationMatchesText(location, text))
    .sort((a, b) => normalizeText(b.name || "").length - normalizeText(a.name || "").length);
  return matches[0] || null;
}

function wantsNearestLocation(text) {
  return /\b(near me|nearest|closest|nearby|my location|closest store|nearest store)\b/i.test(text);
}

function hasCoordinates(location) {
  return Number.isFinite(Number(location?.address?.latitude)) && Number.isFinite(Number(location?.address?.longitude));
}

function distanceKm(from, toLocation) {
  if (!from || !hasCoordinates(toLocation)) return null;
  const lat1 = Number(from.latitude);
  const lon1 = Number(from.longitude);
  const lat2 = Number(toLocation.address.latitude);
  const lon2 = Number(toLocation.address.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;

  const radiusKm = 6371;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function locationLabel(location) {
  return [location.name, location.address?.city].filter(Boolean).join(" - ") || "this location";
}

function addReason(product, reason) {
  const reasons = [reason, ...(product.reasons || [])];
  return {
    ...product,
    reasons: [...new Set(reasons)].slice(0, 3)
  };
}

function availableAt(product, requestedLocation) {
  const requestedKey = locationKey(requestedLocation);
  return productLocations(product).find((location) => locationKey(location) === requestedKey) || null;
}

function nearestAvailableLocation(product, customerLocation) {
  return productLocations(product)
    .map((location) => ({
      location,
      distance: distanceKm(customerLocation, location)
    }))
    .filter((item) => item.distance !== null)
    .sort((a, b) => a.distance - b.distance)[0];
}

export function applyLocationContext(recommendations, candidateRecommendations, products, text, customerLocation) {
  const requestedLocation = findRequestedLocation(products, text);
  const useNearest = wantsNearestLocation(text);
  const pool = candidateRecommendations.length > 0 ? candidateRecommendations : recommendations;

  if (requestedLocation) {
    const locationMatches = pool
      .map((product) => {
        const location = availableAt(product, requestedLocation);
        if (!location) return null;
        return addReason(product, `Available at ${locationLabel(location)} with ${availableQuantity(location)} in stock.`);
      })
      .filter(Boolean);

    if (locationMatches.length > 0) {
      return {
        recommendations: locationMatches.slice(0, 3),
        note: `I found stock at ${locationLabel(requestedLocation)}.`
      };
    }

    return {
      recommendations: recommendations.map((product) =>
        addReason(product, `I could not confirm stock at ${locationLabel(requestedLocation)}, so this is based on overall stock.`)
      ),
      note: `I could not find those exact matches at ${locationLabel(requestedLocation)}, so I used overall available stock.`
    };
  }

  if (useNearest && customerLocation?.latitude && customerLocation?.longitude) {
    const nearestMatches = pool
      .map((product) => {
        const nearest = nearestAvailableLocation(product, customerLocation);
        if (!nearest) return null;
        return {
          ...addReason(
            product,
            `Closest stocked location is ${locationLabel(nearest.location)}, about ${Math.round(nearest.distance)} km away with ${availableQuantity(nearest.location)} in stock.`
          ),
          locationDistance: nearest.distance
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.locationDistance - b.locationDistance);

    if (nearestMatches.length > 0) {
      return {
        recommendations: nearestMatches.slice(0, 3),
        note: "I used your shared browser location to prioritize the closest stocked store."
      };
    }
  }

  if (useNearest) {
    return {
      recommendations,
      note: "I can recommend the closest stocked store if the customer allows browser location access."
    };
  }

  return { recommendations, note: null };
}
