const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "put api here";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const rawTemperature = Number(process.env.OPENAI_TEMPERATURE);
const OPENAI_TEMPERATURE = Number.isFinite(rawTemperature)
  ? Math.min(Math.max(rawTemperature, 0), 1)
  : 0.25;
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export const isOpenAiConfigured = () =>
  Boolean(OPENAI_API_KEY && OPENAI_API_KEY !== "put api here");

const baseHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${OPENAI_API_KEY}`,
});

const requestBody = (messages) => ({
  model: OPENAI_MODEL,
  temperature: OPENAI_TEMPERATURE,
  response_format: { type: "json_object" },
  messages,
});

export const buildEvaluationMessages = ({ title, description, metaTitle, metaDescription }) => [
  {
    role: "system",
    content:
      "You are a strict product content quality evaluator. Rate ecommerce copy using the rubric provided and return JSON only.",
  },
  {
    role: "user",
    content: `Rate the following fields using this rubric. Each field must receive a score between 0 and 10.

Title rubric (5 × 0–2): Relevance & keyword, Specificity, Length (35–70 chars), Readability, Brand/uniqueness.
Description rubric (5 × 0–2): Clarity & structure, Benefits vs features, Detail & trust, Tone & brand fit, Language quality.
Meta title rubric (5 × 0–2): Keyword near start, Brand mention, 45–60 chars, Uniqueness, Clickability.
Meta description rubric (5 × 0–2): 120–155 chars, Keyword present, Clear value prop, CTA/intent, Readability.

overall_score = round(
  0.2 * title_score +
  0.4 * description_score +
  0.2 * meta_title_score +
  0.2 * meta_description_score,
  1
)

Return JSON only:
{
  "title_score": 0,
  "description_score": 0,
  "meta_title_score": 0,
  "meta_description_score": 0,
  "overall_score": 0,
  "comments": {
    "title": "...",
    "description": "...",
    "meta_title": "...",
    "meta_description": "..."
  }
}

Title: "${title ?? ""}"
Description: "${description ?? ""}"
Meta title: "${metaTitle ?? ""}"
Meta description: "${metaDescription ?? ""}"`,
  },
];

export const buildRewriteMessages = (
  { title, description, metaTitle, metaDescription },
  fieldsToImprove,
) => [
  {
    role: "system",
    content:
      "You are a senior ecommerce copywriter. Rewrite only the requested fields so they achieve 9–10/10 on the rubric. Keep product facts accurate and respect maximum lengths.",
  },
  {
    role: "user",
    content: `The following fields scored below 8/10: ${fieldsToImprove.join(", ")}.
Rewrite only those fields to hit the rubric targets. Maximum lengths: title 70 characters, meta title 60 characters, meta description 155 characters.

Return JSON only:
{
  "title": "... or null if unchanged ...",
  "description": "...",
  "meta_title": "...",
  "meta_description": "..."
}

Original fields:
Title: "${title ?? ""}"
Description: "${description ?? ""}"
Meta title: "${metaTitle ?? ""}"
Meta description: "${metaDescription ?? ""}"`,
  },
];

const PRODUCT_FIELD_CONFIG = {
  title: {
    label: "Product title",
    baseRules: [
      "Keep the original main phrase at the beginning (do not reorder or remove it).",
      "Append up to 2–3 attributes (product type, audience, key color/material/fit).",
      "Target 40–70 characters, never exceed 80.",
      "No sentences, emojis, pricing, or hype terms. Use title case.",
    ],
  },
  description: {
    label: "Product description",
    baseRules: [
      "Structure: intro paragraph (25–60 words), 3–6 <li> bullets (≤15 words each), optional closing sentence.",
      "Mention factual benefits, materials, fits, and use cases only; do not invent details.",
      "120–250 words max, confident but not over-hyped.",
      "HTML must use only <p>, <ul>, <li>, <strong>, <em>.",
      "No pricing, discounts, shipping, or policy info.",
    ],
  },
  meta_title: {
    label: "Meta title",
    baseRules: [
      "45–60 characters (max 60).",
      "Start with the main product keyword; include brand if provided.",
      "Format like “Product Name | Brand”.",
      "No generic phrases, all caps, emojis, or unnecessary variant details.",
    ],
  },
  meta_description: {
    label: "Meta description",
    baseRules: [
      "120–155 characters (max 160).",
      "Mention the main keyword once naturally.",
      "Include one benefit/use case, one differentiator, and a soft CTA (“Shop now”, “Discover more”, etc.).",
      "No pricing, discounts, shipping info, or spam.",
    ],
  },
};

const COLLECTION_FIELD_CONFIG = {
  title: {
    label: "Collection title",
    baseRules: [
      "Capture the collection theme or shopper intent in 45–65 characters.",
      "Mention the core product category or audience if it is obvious from the data.",
      "Use title case. Avoid dates unless they are part of the collection name.",
      "No emojis, salesy language, or excessive punctuation.",
    ],
  },
  description: {
    label: "Collection description",
    baseRules: [
      "Structure: 2 short sentences (max ~20–25 words each) followed by a <ul> containing EXACTLY three <li> bullet points, then an optional closing sentence.",
      "Speak only in generic product categories (chairs, candles, knit sets, etc.). Never reference specific product titles, SKUs, or brand names.",
      "Keep 60–100 words total. HTML allowed: <p>, <ul>, <li>, <strong>, <em>. No other tags.",
      "No pricing, discounts, shipping info, inventory promises, or guarantees. Focus on shared aesthetics, materials, or use cases.",
    ],
  },
  meta_title: {
    label: "Collection meta title",
    baseRules: [
      "45–60 characters (max 60).",
      "Start with the collection name or main keyword, then optional brand after a separator (e.g. “ | Brand”).",
      "Make it clear this is a collection or edit (e.g. “Indoor & Outdoor Decor Collection”).",
      "No hype phrases, emojis, ALL CAPS, or mentions of prices/discounts.",
    ],
  },
  meta_description: {
    label: "Collection meta description",
    baseRules: [
      "120–155 characters (max 160).",
      "Summarize the assortment (what type of products, for which space/audience) and mention one differentiator (materials, curation, versatility, etc.).",
      "Include a soft CTA like “Explore the collection” or “Discover the edit”.",
      "Do not mention prices, discounts, shipping, inventory levels, or FOMO/urgency.",
    ],
  },
};


const buildFieldSection = (field, fieldConfigMap, settings = {}) => {
  const config = fieldConfigMap[field];
  if (!config) {
    return "";
  }
  const templatePrompt = settings?.templates?.[field]?.prompt;
  const customInstruction = settings?.custom_instructions?.[field]?.trim();

  return [
    `${config.label}:`,
    "Base rules:",
    ...config.baseRules.map((rule) => `- ${rule}`),
    "",
    `Template style: ${templatePrompt || "(none selected)"}`,
    "",
    `Custom merchant instructions (override style when present): ${
      customInstruction || "(none provided)"
    }`,
  ].join("\n");
};

export const buildGenerationMessages = ({ product, settings }) => {
  const input = JSON.stringify({ product, settings }, null, 2);
  const fields = Array.isArray(settings?.fields) ? settings.fields : [];
  const languageText = settings?.language || "English";
  const toneSnippet =
    settings?.tone_snippet ||
    "Use a clear, neutral ecommerce tone. Concise, professional, no jokes, no hype.";
  const blockedTerms = Array.isArray(settings?.blocked_terms) ? settings.blocked_terms : [];

  const fieldSections = fields
    .map((field) => buildFieldSection(field, PRODUCT_FIELD_CONFIG, settings))
    .filter(Boolean)
    .join("\n\n");

  const outputSchema = `{
  "title": "string or null if not requested",
  "description_html": "string or null",
  "meta_title": "string or null",
  "meta_description": "string or null"
}`;

  const userContent = `You are generating Shopify product content. Obey the priority: Base rules > Custom merchant instructions > Template style.

Target language: ${languageText}
${fieldSections ? `\n${fieldSections}\n` : ""}
Creative tone:
- ${toneSnippet}

${blockedTerms.length ? `Words to avoid:\n- Do not use the following words or close variants in ANY field:\n  "{${blockedTerms.join(", ")}}"\n\n` : ""}Product data (JSON):

${input}

Generate only the fields listed in settings.fields and respond with JSON in this exact shape:
${outputSchema}`;

  return [
    {
      role: "system",
      content:
        "You are an expert Shopify product copywriter. Write concise, high-converting content for fashion and streetwear products. Never invent materials, colors, prices, or sizes that are not provided. Respect the target language and length constraints strictly. Return only valid JSON using the exact schema requested.",
    },
    {
      role: "user",
      content: userContent,
    },
  ];
};

export const buildCollectionGenerationMessages = ({ collection, settings }) => {
  const input = JSON.stringify({ collection, settings }, null, 2);
  const fields = Array.isArray(settings?.fields) ? settings.fields : [];
  const languageText = settings?.language || "English";
  const toneSnippet =
    settings?.tone_snippet ||
    "Use a clear, neutral ecommerce tone. Concise, professional, no jokes, no hype.";
  const blockedTerms = Array.isArray(settings?.blocked_terms) ? settings.blocked_terms : [];

  const fieldSections = fields
    .map((field) => buildFieldSection(field, COLLECTION_FIELD_CONFIG, settings))
    .filter(Boolean)
    .join("\n\n");

  const productList = Array.isArray(collection?.products) ? collection.products : [];
  const approxCount = (() => {
    const rawCount = collection?.productsCount;
    if (typeof rawCount === "number") return rawCount;
    const parsed = Number(rawCount);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return productList.length || 0;
  })();
  const productTypes = Array.from(
    new Set(
      productList
        .map((product) => product?.product_type?.trim())
        .filter(Boolean),
    ),
  ).slice(0, 5);
  const vendors = Array.from(
    new Set(
      productList
        .map((product) => product?.vendor?.trim())
        .filter(Boolean),
    ),
  ).slice(0, 5);
  const heroProducts = productList.slice(0, 5).map((product) => {
    const parts = [product?.title?.trim()];
    const attributes = [product?.product_type, product?.vendor].filter(Boolean);
    if (attributes.length) {
      parts.push(`(${attributes.join(" • ")})`);
    }
    return parts.filter(Boolean).join(" ");
  });
  const collectionSnapshotLines = [];
  if (approxCount) {
    collectionSnapshotLines.push(`- Approximate product count: ${approxCount}`);
  }
  if (productTypes.length) {
    collectionSnapshotLines.push(`- Primary product types: ${productTypes.join(", ")}`);
  }
  if (vendors.length) {
    collectionSnapshotLines.push(`- Key brands/vendors: ${vendors.join(", ")}`);
  }
  if (heroProducts.length) {
    collectionSnapshotLines.push(
      `- Hero products:\n${heroProducts.map((line) => `  • ${line}`).join("\n")}`,
    );
  }
  const collectionSnapshot = collectionSnapshotLines.length
    ? `Collection snapshot:\n${collectionSnapshotLines.join("\n")}\n`
    : "";

  const outputSchema = `{
  "title": "string or null if not requested",
  "description_html": "string or null",
  "meta_title": "string or null",
  "meta_description": "string or null"
}`;

  const userContent = `You are generating Shopify collection content. Obey the priority: Base rules > Custom merchant instructions > Template style.

Target language: ${languageText}
${fieldSections ? `\n${fieldSections}\n` : ""}
Creative tone:
- ${toneSnippet}

Hard structural requirements (must follow every time):
- First paragraph must be exactly 2 sentences, each under ~25 words.
- Follow with a <ul> that contains EXACTLY three <li> bullet points summarizing the assortment.
- Use only generic product categories (chairs, candles, knit sets, etc.). Never mention product titles, SKUs, or brand names even if provided in data.
- Keep total word count between 60 and 100 words. Allowed HTML tags: <p>, <ul>, <li>, <strong>, <em>. No other markup.

${collectionSnapshot ? `${collectionSnapshot}\n` : ""}${blockedTerms.length ? `Words to avoid:\n- Do not use the following words or close variants in ANY field:\n  "{${blockedTerms.join(", ")}}"\n\n` : ""}Collection data (JSON):

${input}

Generate only the fields listed in settings.fields and respond with JSON in this exact shape:
${outputSchema}`;

  return [
    {
      role: "system",
      content:
        "You are an expert Shopify collection copywriter. Default structure for descriptions: 2 short sentences followed by exactly 3 bullet points, unless custom merchant instructions override this. Describe curated assortments with concise, benefit-led language. Refer only to generic product categories—never mention specific product titles, SKUs, or brand names. Never invent materials, colors, prices, SKUs, or guarantees that are not provided. Respect the target language and length constraints strictly. Return only valid JSON using the exact schema requested.",
    },
    {
      role: "user",
      content: userContent,
    },
  ];
};

export const buildAltTextMessages = ({
  productTitle,
  productHandle,
  existingAltText,
  imageUrl,
}) => {
  if (!imageUrl) {
    throw new Error("Image URL is required for alt text generation.");
  }
  const identifier = productTitle || productHandle || "product image";
  const previousAlt = existingAltText ? `Existing alt text: "${existingAltText}".` : "No existing alt text.";
  const rules = [
    "Maximum 15 words.",
    "Describe only what is visible in the image.",
    "No opinions, emotions, or marketing language.",
    "Do not guess brand names, model numbers, or colors.",
    "Never mention personal identity or demographic details.",
  ]
    .map((rule) => `- ${rule}`)
    .join("\n");

  const userText = `Write new ecommerce image alt text following these rules:
${rules}

Product title: "${identifier}"
${previousAlt}

Return valid JSON only:
{
  "alt_text": "..."
}`;

  return [
    {
      role: "system",
      content:
        "You are an accessibility specialist who writes concise, descriptive alt text for ecommerce imagery. Always obey the requested JSON response schema.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: userText,
        },
        {
          type: "image_url",
          image_url: {
            url: imageUrl,
            detail: "auto",
          },
        },
      ],
    },
  ];
};

export const callOpenAiJson = async (messages) => {
  if (!isOpenAiConfigured()) {
    throw new Error("OpenAI API key is not configured.");
  }

  const response = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(requestBody(messages)),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response missing content.");
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error("Failed to parse OpenAI JSON response.");
  }
};
