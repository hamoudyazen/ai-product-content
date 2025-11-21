const MAX_IMAGES_PER_PRODUCT = 50;

export const PRODUCT_FIELD_ALLOWLIST = ["title", "description", "meta_title", "meta_description"];
export const COLLECTION_FIELD_ALLOWLIST = ["title", "description", "meta_title", "meta_description"];
export const ALT_TEXT_FIELD_ALLOWLIST = ["alt_text"];

const coerceArray = (value) => (Array.isArray(value) ? value : []);

export const sanitizeIdList = (ids = []) => {
  const unique = new Set();
  coerceArray(ids).forEach((id) => {
    if (typeof id === "string") {
      const trimmed = id.trim();
      if (trimmed) {
        unique.add(trimmed);
      }
    }
  });
  return Array.from(unique);
};

export const uniqueFieldList = (fields = []) => {
  const unique = new Set();
  coerceArray(fields).forEach((field) => {
    if (typeof field === "string" && field.trim()) {
      unique.add(field.trim());
    }
  });
  return Array.from(unique);
};

export const calculateWorkItems = (targetCount, fields = []) => {
  const uniqueFields = uniqueFieldList(fields);
  if (targetCount <= 0 || uniqueFields.length === 0) {
    return 0;
  }
  return targetCount * uniqueFields.length;
};

export const clampImageTargetCount = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), MAX_IMAGES_PER_PRODUCT);
};

export const calculateAltTextItems = (productIds = [], settings = {}) => {
  const ids = sanitizeIdList(productIds);
  if (!ids.length) {
    return 0;
  }

  const totalFromSettings = Number(settings?.total_image_targets);
  if (Number.isFinite(totalFromSettings) && totalFromSettings > 0) {
    const maxPossible = ids.length * MAX_IMAGES_PER_PRODUCT;
    return Math.min(Math.floor(totalFromSettings), maxPossible);
  }

  const imageCounts = settings?.image_counts;
  if (imageCounts && typeof imageCounts === "object") {
    return ids.reduce((sum, productId) => {
      if (Object.prototype.hasOwnProperty.call(imageCounts, productId)) {
        const rawCount = clampImageTargetCount(Number(imageCounts[productId]));
        return sum + rawCount;
      }
      return sum + 1;
    }, 0);
  }

  return ids.length;
};

export const isValidProductGid = (value) =>
  typeof value === "string" && value.startsWith("gid://shopify/Product/");

export const isValidCollectionGid = (value) =>
  typeof value === "string" && value.startsWith("gid://shopify/Collection/");

export { MAX_IMAGES_PER_PRODUCT };
