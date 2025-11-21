const CTA_WORDS = ["shop", "discover", "explore", "learn", "find", "get"];
const VALUE_WORDS = ["handmade", "crafted", "premium", "durable", "soft", "lightweight", "limited"];
const GENERIC_PHRASES = ["buy now", "best price", "sale", "free shipping"];

const stripHtml = (html = "") =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clampTwoPoint = (value) => Math.max(0, Math.min(2, value));

const scoreLength = (text = "", min, max) => {
  const length = text.trim().length;
  if (!length) return 0;
  if (length >= min && length <= max) {
    return 2;
  }
  const delta = Math.abs(length - (length < min ? min : max));
  const span = Math.max(20, max - min);
  return clampTwoPoint(2 - (delta / span) * 2);
};

const scoreWordCount = (text = "", minWords, maxWords) => {
  const words = text.trim().split(/\s+/).length;
  if (words >= minWords && words <= maxWords) {
    return 2;
  }
  if (words >= Math.round(minWords * 0.75) && words <= Math.round(maxWords * 1.25)) {
    return 1;
  }
  return 0;
};

const scoreReadability = (text = "") => {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const uppercaseRatio =
    trimmed.replace(/[^A-Z]/g, "").length / Math.max(1, trimmed.replace(/[^A-Za-z]/g, "").length);
  if (uppercaseRatio > 0.6 || /[!]{3,}/.test(trimmed)) {
    return 0;
  }
  if (uppercaseRatio > 0.3) {
    return 1;
  }
  return 2;
};

const containsAny = (text = "", words = []) => {
  return words.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
};

const scoreTitle = (product) => {
  const title = product?.title || "";
  const productType = (product?.productType || "").toLowerCase();
  const vendor = (product?.vendor || "").toLowerCase();
  const lowerTitle = title.toLowerCase();

  const relevanceScore = clampTwoPoint(
    lowerTitle.includes(productType) || lowerTitle.includes(vendor) ? 2 : 1,
  );
  const specificityScore = scoreWordCount(title, 3, 10);
  const lengthScore = scoreLength(title, 35, 70);
  const readabilityScore = scoreReadability(title);
  const brandScore = clampTwoPoint(
    vendor && lowerTitle.includes(vendor) ? 2 : productType ? 1 : 0,
  );

  return (
    relevanceScore + specificityScore + lengthScore + readabilityScore + brandScore
  );
};

const scoreDescription = (product) => {
  const descriptionHtml = product?.descriptionHtml || "";
  const description = stripHtml(descriptionHtml);
  if (!description) {
    return 0;
  }

  const hasStructure = /<li|<\/p>|<br\/?>|\n{2,}/i.test(descriptionHtml);
  const clarityScore = clampTwoPoint(hasStructure ? 2 : 1);

  const benefitsScore = clampTwoPoint(
    /you|your|ideal|perfect|helps|designed/i.test(description) ? 2 : 1,
  );

  const detailScore = clampTwoPoint(
    /%|cm|mm|inches|cotton|wool|leather|polyester|fit|care|wash/i.test(description) ? 2 : 1,
  );

  const toneScore = clampTwoPoint(
    containsAny(description, ["handcrafted", "sleek", "minimal", "premium", "bold"]) ? 2 : 1,
  );

  const languageScore = scoreReadability(description);

  return clarityScore + benefitsScore + detailScore + toneScore + languageScore;
};

const scoreMetaTitle = (product) => {
  const metaTitle = product?.seo?.title || product?.title || "";
  const productType = (product?.productType || "").toLowerCase();
  const vendor = (product?.vendor || "").toLowerCase();
  const lower = metaTitle.toLowerCase();
  const keywordNearStart = productType && lower.startsWith(productType.slice(0, 15));
  const uniquenessScore = clampTwoPoint(
    GENERIC_PHRASES.some((phrase) => lower.includes(phrase)) ? 1 : 2,
  );
  const clickabilityScore = clampTwoPoint(containsAny(lower, CTA_WORDS) ? 2 : 1);

  const scores = [
    clampTwoPoint(keywordNearStart ? 2 : 1),
    clampTwoPoint(vendor && lower.includes(vendor) ? 2 : 1),
    scoreLength(metaTitle, 45, 60),
    uniquenessScore,
    clickabilityScore,
  ];

  return scores.reduce((total, score) => total + score, 0);
};

const scoreMetaDescription = (product) => {
  const metaDescription = product?.seo?.description || "";
  const productType = (product?.productType || "").toLowerCase();
  const title = (product?.title || "").toLowerCase();
  const lower = metaDescription.toLowerCase();

  const lengthScore = scoreLength(metaDescription, 120, 155);
  const keywordScore = clampTwoPoint(
    productType && lower.includes(productType) ? 2 : lower.includes(title.split(" ")[0] || "") ? 1 : 0,
  );
  const valueScore = clampTwoPoint(containsAny(lower, VALUE_WORDS) ? 2 : 1);
  const ctaScore = clampTwoPoint(containsAny(lower, CTA_WORDS) ? 2 : 1);
  const readabilityScore = scoreReadability(metaDescription);

  return lengthScore + keywordScore + valueScore + ctaScore + readabilityScore;
};

export const evaluateProductQuality = (product) => {
  const titleScore = scoreTitle(product);
  const descriptionScore = scoreDescription(product);
  const metaTitleScore = scoreMetaTitle(product);
  const metaDescriptionScore = scoreMetaDescription(product);
  const overallScore = parseFloat(
    (
      0.2 * titleScore +
      0.4 * descriptionScore +
      0.2 * metaTitleScore +
      0.2 * metaDescriptionScore
    ).toFixed(1),
  );
  return {
    titleScore,
    descriptionScore,
    metaTitleScore,
    metaDescriptionScore,
    overallScore,
  };
};

export const getQualityLabel = (score) => {
  if (score >= 8) {
    return "Great";
  }
  if (score >= 5) {
    return "OK";
  }
  return "Poor";
};

export const aggregateProductQuality = (products = []) => {
  const evaluations = products.map(evaluateProductQuality);
  if (!evaluations.length) {
    return { averageScore: null, label: null, sampleSize: 0 };
  }
  const averageScore =
    evaluations.reduce((total, { overallScore }) => total + overallScore, 0) /
    evaluations.length;
  const rounded = parseFloat(averageScore.toFixed(1));
  return {
    averageScore: rounded,
    label: getQualityLabel(rounded),
    sampleSize: evaluations.length,
  };
};

export const rateProductContent = (product) => evaluateProductQuality(product).overallScore;
