import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrCreateShopCredit } from "../server/shopCredit.server";
import { rateProductContent } from "../utils/productQuality";
import { PLAN_CONFIG, DEFAULT_PLAN } from "../utils/planConfig";
import { calculateWorkItems } from "../utils/creditMath";

const demoRawProduct = (product) => {
  const fallbackDescription = `<p>${product.title} is a demo product used to populate the table.</p>`;
  return {
    id: product.id,
    title: product.title,
    handle: product.title.toLowerCase().replace(/\s+/g, "-"),
    vendor: "Demo Brand",
    product_type: product.short || "Demo",
    tags: ["demo", "sample"],
    options: [],
    variants: [],
    collections: [],
    body_html: fallbackDescription,
    metafields: {},
    seo: {
      title: product.title,
      description: fallbackDescription,
    },
  };
};

const stripHtmlTags = (input) =>
  typeof input === "string" ? input.replace(/<[^>]*>/g, " ") : "";

const truncateText = (input, limit = 90) => {
  if (!input) return "";
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1).trim()}…`;
};

const HOST_STORAGE_KEY = "shopify-app-host";

const fallbackProductRows = [
  {
    id: "gid://shopify/Product/1",
    title: "Black Leather Bag",
    status: "ACTIVE",
    short: "Bag",
    rating: 6.8,
    image:
      "https://cdn.shopify.com/s/files/1/0946/3336/1723/files/black-bag-over-the-shoulder_925x_5d6c686e-50ca-4fe6-94a9-32756a19b315_small.jpg?v=1763479420",
    altText: "Black leather bag",
  },
  {
    id: "gid://shopify/Product/2",
    title: "Blue Silk Tuxedo",
    status: "ACTIVE",
    short: "Suit",
    rating: 7.4,
    image:
      "https://cdn.shopify.com/s/files/1/0946/3336/1723/files/blue-suit-and-tie_925x_3b0b0fce-045f-4703-b12e-131d770a34de_small.jpg?v=1763479420",
    altText: "Blue silk tuxedo on hanger",
  },
  {
    id: "gid://shopify/Product/3",
    title: "Chequered Red Shirt",
    status: "ACTIVE",
    short: "Shirt",
    rating: 5.9,
    image:
      "https://cdn.shopify.com/s/files/1/0946/3336/1723/files/red-plaid-shirt_925x_f0105b70-9993-43e7-9b35-5a13c2af4347_small.jpg?v=1763479420",
    altText: "Red checkered shirt",
  },
  {
    id: "gid://shopify/Product/4",
    title: "Classic Leather Jacket",
    status: "ACTIVE",
    short: "Jacket",
    rating: 8.1,
    image:
      "https://cdn.shopify.com/s/files/1/0946/3336/1723/files/leather-jacket-vintage_925x_ae32d34f-8f72-49c1-918f-8b6abcad95df_small.jpg?v=1763479420",
    altText: "Brown leather jacket",
  },
  {
    id: "gid://shopify/Product/5",
    title: "Classic Varsity Top",
    status: "ACTIVE",
    short: "Top",
    rating: 6.2,
    image:
      "https://cdn.shopify.com/s/files/1/0946/3336/1723/files/varsity-jacket_925x_68c9c7cd-b52a-40ea-b3a1-e9ce466cfdf4_small.jpg?v=1763479420",
    altText: "Varsity jacket",
  },
  {
    id: "gid://shopify/Product/6",
    title: "Dark Denim Top",
    status: "ACTIVE",
    short: "Denim",
    rating: 5.4,
    image:
      "https://cdn.shopify.com/s/files/1/0946/3336/1723/files/denim-shirt_925x_3fb321eb-db2d-4ea2-a97c-c57ed45d8b8b_small.jpg?v=1763479420",
    altText: "Dark denim shirt",
  },
  {
    id: "gid://shopify/Product/7",
    title: "Example Hat",
    status: "ARCHIVED",
    short: "Hat",
    rating: 4.1,
    image:
      "https://cdn.shopify.com/s/files/1/0946/3336/1723/files/grey-wool-hat_925x_25c4842f-a70a-4f49-aba5-c46b52c161c7_small.jpg?v=1763479420",
    altText: "Grey wool hat",
  },
  {
    id: "gid://shopify/Product/8",
    title: "Example Pants",
    status: "DRAFT",
    short: "Pants",
    rating: 3.7,
    image:
      "https://cdn.shopify.com/s/files/1/0946/3336/1723/files/denim-jeans_925x_24fd3b43-8ecc-4e7d-b2d7-a650912c6d8d_small.jpg?v=1763479420",
    altText: "Folded denim pants",
  },
].map((product) => ({
  ...product,
  rawProduct: demoRawProduct(product),
}));

const normalizeMetafields = (edges) => {
  const output = {};
  edges?.forEach(({ node }) => {
    if (!node?.key) {
      return;
    }
    const keyName =
      node.namespace && node.namespace !== "global"
        ? `${node.namespace}.${node.key}`
        : node.key;
    output[keyName] = node.value;
  });
  return output;
};

const collectionRows = [
  {
    id: "gid://shopify/Collection/1",
    title: "Spring essentials",
    status: "ACTIVE",
    short: "21 products",
  },
  {
    id: "gid://shopify/Collection/2",
    title: "Holiday gifts",
    status: "ACTIVE",
    short: "34 products",
  },
  {
    id: "gid://shopify/Collection/3",
    title: "Archived styles",
    status: "ARCHIVED",
    short: "12 products",
  },
];

const languages = [
  "Afrikaans",
  "Albanian",
  "Amharic",
  "Arabic",
  "Armenian",
  "Azerbaijani",
  "Basque",
  "Belarusian",
  "Bengali",
  "Bosnian",
  "Bulgarian",
  "Catalan",
  "Cebuano",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
  "Croatian",
  "Czech",
  "Danish",
  "Dutch",
  "English",
  "Esperanto",
  "Estonian",
  "Filipino",
  "Finnish",
  "French",
  "Galician",
  "Georgian",
  "German",
  "Greek",
  "Gujarati",
  "Haitian Creole",
  "Hausa",
  "Hebrew",
  "Hindi",
  "Hungarian",
  "Icelandic",
  "Igbo",
  "Indonesian",
  "Irish",
  "Italian",
  "Japanese",
  "Javanese",
  "Kannada",
  "Kazakh",
  "Khmer",
  "Kinyarwanda",
  "Korean",
  "Kurdish",
  "Kyrgyz",
  "Lao",
  "Latvian",
  "Lithuanian",
  "Luxembourgish",
  "Macedonian",
  "Malagasy",
  "Malay",
  "Malayalam",
  "Maltese",
  "Maori",
  "Marathi",
  "Mongolian",
  "Nepali",
  "Norwegian",
  "Nyanja",
  "Odia",
  "Pashto",
  "Persian",
  "Polish",
  "Portuguese",
  "Punjabi",
  "Romanian",
  "Russian",
  "Samoan",
  "Serbian",
  "Sinhala",
  "Slovak",
  "Slovenian",
  "Somali",
  "Spanish",
  "Sundanese",
  "Swahili",
  "Swedish",
  "Tajik",
  "Tamil",
  "Telugu",
  "Thai",
  "Turkish",
  "Turkmen",
  "Ukrainian",
  "Urdu",
  "Uyghur",
  "Uzbek",
  "Vietnamese",
  "Welsh",
  "Western Frisian",
  "Xhosa",
  "Yiddish",
  "Yoruba",
  "Zulu",
];

const creativeTones = [
  {
    value: "neutral",
    label: "Neutral ecommerce (recommended)",
    snippet: "Use a clear, neutral ecommerce tone. Concise, professional, no jokes, no hype.",
  },
  {
    value: "conversational",
    label: "Conversational & friendly",
    snippet:
      "Use a conversational, friendly tone. Sound human and approachable, but still concise and professional.",
  },
  {
    value: "premium",
    label: "Premium & minimal",
    snippet: "Use a premium, minimal tone. Few words, clean phrasing, no exclamation marks or slang.",
  },
  {
    value: "bold",
    label: "Bold & promotional",
    snippet:
      "Use a bold marketing tone with more energy. Short impactful sentences, but avoid cringe, clickbait or ALL CAPS.",
  },
  {
    value: "technical",
    label: "Technical & factual",
    snippet:
      "Use a technical, factual tone. Focus on specs and concrete details, avoid emotional or lifestyle language.",
  },
];

const getRatingTone = (rating) => {
  if (rating >= 8) {
    return "success";
  }
  if (rating >= 5) {
    return "attention";
  }
  return "critical";
};

const generationTypes = [
  { id: "description", label: "Product description" , description: "AI-generated description with intro + feature bullets." },
  { id: "productTitle", label: "Product title", description: "SEO-ready product title with main keyword."  },
  { id: "metaDescription", label: "Meta description", description: "Search-optimized snippet shown in Google results."  },
  { id: "metaTitle", label: "Meta title", description: "Short page title used in search listings."  },
];

const PRODUCT_FIELD_NAME_BY_TYPE = {
  productTitle: "title",
  description: "description",
  metaTitle: "meta_title",
  metaDescription: "meta_description",
};

const templateCategories = [
  {
    id: "clean-neutral",
    title: "Clean & Neutral",
    templates: [
      {
        name: "Direct Commerce",
        description: "Default neutral ecommerce tone for most products.",
        prompt:
          "Use a neutral, professional ecommerce tone. Be clear and concise, focus on what the product is and why it is useful. Avoid jokes, hype, or heavy storytelling.",
        sample:
          "Reliable default voice that highlights the product purpose and benefits without extra flair.",
        tags: ["neutral", "commerce", "default"],
      },
      {
        name: "Skimmable & Minimal",
        description: "Ultra short copy that is easy to scan.",
        prompt:
          "Prioritize brevity and scannability. Keep titles compact, descriptions short with simple sentences, and meta fields direct. Remove all filler and marketing buzzwords.",
        sample: "Minimal phrasing that surfaces only essential facts for fast reading.",
        tags: ["minimal", "succinct", "scan-friendly"],
      },
      {
        name: "Benefits First",
        description: "Lead with value delivered to the shopper.",
        prompt:
          "Lead with customer benefits, then briefly mention features that create those benefits. Every field should answer \"what do I gain?\" in plain language.",
        sample:
          "Copy starts with the outcome for the buyer before mapping to supporting specs.",
        tags: ["benefits", "value", "outcome"],
      },
      {
        name: "Specification Driven",
        description: "Factual tone for technical or hardware products.",
        prompt:
          "Keep the tone factual and technical. Highlight key specs, materials and dimensions. Avoid emotional language; focus on measurable attributes and performance.",
        sample: "Reads like a spec sheet translated into customer-friendly phrasing.",
        tags: ["technical", "hardware", "specs"],
      },
      {
        name: "Comparison Minded",
        description: "Quietly positions the product as an upgrade.",
        prompt:
          "Subtly frame the product as an upgrade from a generic alternative, without naming competitors. Emphasize what is improved (comfort, durability, speed, etc.).",
        sample: "Explains how this item improves on a typical baseline experience.",
        tags: ["comparison", "upgrade", "differentiation"],
      },
      {
        name: "Collection Consistent",
        description: "Shared language for a set of similar products.",
        prompt:
          "Write copy that works across a collection of similar products. Avoid overly specific details; focus on the shared style, use case and brand tone.",
        sample: "Keeps wording broad so multiple SKUs can reuse the same angle.",
        tags: ["collection", "cohesive", "shared-tone"],
      },
    ],
  },
  {
    id: "storytelling-brand",
    title: "Storytelling & Brand",
    templates: [
      {
        name: "Soft Storytelling",
        description: "Adds a light narrative moment without long prose.",
        prompt:
          "Add a light narrative touch: hint at where or how the product is used, but stay concise. One short scene or feeling is enough. Do not write long paragraphs of fiction.",
        sample: "Paints a quick scene before jumping back into benefits.",
        tags: ["story", "narrative", "mood"],
      },
      {
        name: "Craft & Workshop",
        description: "Highlights handmade or small batch production.",
        prompt:
          "Emphasize craft, materials and people behind the product. Mention how it is made or finished, but keep all details plausible and grounded in the provided data.",
        sample: "Spotlights artisanship and finishing touches.",
        tags: ["craft", "atelier", "handmade"],
      },
      {
        name: "Lifestyle Snapshot",
        description: "Connects the product to a lifestyle moment.",
        prompt:
          "Tie the product to a specific lifestyle moment (weekend, city walk, studio session, home setting). Describe the vibe in one or two short sentences, then return to benefits.",
        sample: "Briefly describes who is using the product and where.",
        tags: ["lifestyle", "scene", "fashion"],
      },
      {
        name: "Gift Story",
        description: "Positions the item as a thoughtful gift.",
        prompt:
          "Present the product as a thoughtful gift. Mention who it is ideal for and why. Keep tone warm but not cheesy; avoid forced holiday clichés unless the data mentions an occasion.",
        sample: "Explains why it makes sense as a present for a specific person.",
        tags: ["gift", "occasion", "warm"],
      },
      {
        name: "Behind the Scenes",
        description: "References design intent or studio perspective.",
        prompt:
          "Reference the brand's process, design intent or inspiration briefly. Make it feel like a peek into the studio, without long origin stories.",
        sample: "Reads like a quick studio note from the design team.",
        tags: ["studio", "process", "brand"],
      },
      {
        name: "Subtle Humor",
        description: "Adds a gentle playful line.",
        prompt:
          "Keep the overall tone professional but allow one short, subtle playful line. The joke must be product-related, neutral and safe, and must not dominate the copy.",
        sample: "One quick wink while keeping the rest buttoned-up.",
        tags: ["personality", "humor", "playful"],
      },
    ],
  },
  {
    id: "performance-usecases",
    title: "Performance & Use Case",
    templates: [
      {
        name: "Daily Workhorse",
        description: "Frames the product as an everyday essential.",
        prompt:
          "Position the product as a reliable everyday choice. Highlight comfort, reliability and ease of use. Show how it fits seamlessly into a daily routine.",
        sample: "Feels like instructions for a dependable staple.",
        tags: ["daily", "essential", "reliability"],
      },
      {
        name: "Performance Focus",
        description: "Sports/training gear tone.",
        prompt:
          "Emphasize performance: durability, support, breathability, speed, or similar. Use concrete language tied to features; avoid vague claims like \"next-level\".",
        sample: "Reads like athletic copy with measurable benefits.",
        tags: ["performance", "sports", "technical"],
      },
      {
        name: "Outdoor & Adventure",
        description: "Highlights rugged scenarios and versatility.",
        prompt:
          "Focus on outdoor scenarios and challenging conditions. Mention stability, protection or versatility in real use, not extreme hyperbole.",
        sample: "Puts the reader on the trail, campsite, or in transit.",
        tags: ["outdoor", "adventure", "travel"],
      },
      {
        name: "Comfort & Fit",
        description: "Apparel tone centered on feel and movement.",
        prompt:
          "Highlight fit, feel and movement. Use language around softness, stretch, structure and how it feels on the body, based strictly on the provided materials/fit data.",
        sample: "Helps shoppers imagine fabric against skin and range of motion.",
        tags: ["comfort", "fit", "apparel"],
      },
      {
        name: "Task Optimized",
        description: "Great for tools or accessories.",
        prompt:
          "Explain exactly which task the product makes easier and how. Use simple, instructional phrasing and avoid lifestyle fluff.",
        sample: "Sounds like straightforward instructions for getting jobs done.",
        tags: ["tools", "tasks", "utility"],
      },
      {
        name: "Upgrade Path",
        description: "Positions item as newer/premium version.",
        prompt:
          "Present the product as a smart upgrade from a basic option. Call out one or two specific improvements (material, performance, workflow), not generic \"better than ever\" claims.",
        sample: "Focuses on concrete enhancements over older models.",
        tags: ["upgrade", "premium", "improvement"],
      },
    ],
  },
  {
    id: "trust-risk",
    title: "Social Proof & Trust",
    templates: [
      {
        name: "Rated & Reviewed",
        description: "Uses review snippets to reinforce trust.",
        prompt:
          "If rating or review snippets are provided, reference them briefly (\"customer favorite\", \"rated highly\"). Do not invent numbers. Use this to reinforce trust, not as the main focus.",
        sample: "Mentions praise while keeping spotlight on the product.",
        tags: ["reviews", "social-proof", "trust"],
      },
      {
        name: "Guarantee & Support",
        description: "Highlights warranties or support.",
        prompt:
          "Mention guarantees, warranty or support once, in one short clause. Use it to reduce perceived risk, while keeping the bulk of the copy about the product itself.",
        sample: "Adds a reassuring clause around support or warranty.",
        tags: ["support", "warranty", "risk-reduction"],
      },
      {
        name: "Safe & Compliant",
        description: "Tone for regulated/safety items.",
        prompt:
          "Highlight safety, reliability and relevant standards or certifications provided in the data. Tone must be precise and calm, avoiding any medical or legal claims not explicitly given.",
        sample: "Reads like compliant marketing collateral.",
        tags: ["safety", "compliance", "regulated"],
      },
      {
        name: "Community Favorite",
        description: "Leans on bestseller status.",
        prompt:
          "Present the product as a long-standing favorite or bestseller if that status is provided. Emphasize consistency and trust, not hype.",
        sample: "Makes it feel tried-and-true.",
        tags: ["community", "bestseller", "legacy"],
      },
      {
        name: "Honest Minimalism",
        description: "No-nonsense quality-first voice.",
        prompt:
          "Use very straightforward language. Emphasize build quality, materials and longevity. Avoid exaggeration and trendy vocabulary.",
        sample: "Reads clean and confident without marketing buzz.",
        tags: ["minimalism", "quality", "longevity"],
      },
      {
        name: "Support-Led",
        description: "Mentions sizing/care/support resources.",
        prompt:
          "Briefly mention helpful sizing guides, care information or customer support if present. Make buyers feel they will not be left alone after purchase.",
        sample: "Assures shoppers there is help post-purchase.",
        tags: ["support", "guidance", "service"],
      },
    ],
  },
  {
    id: "sustainability-values",
    title: "Sustainability & Values",
    templates: [
      {
        name: "Sustainable Choice",
        description: "Highlights eco materials or processes.",
        prompt:
          "When sustainability data is provided, highlight it clearly and concretely (organic cotton, recycled polyester, refill system). Avoid vague \"eco-friendly\" without a specific detail.",
        sample: "Calls out tangible environmental benefits backed by data.",
        tags: ["sustainable", "materials", "eco"],
      },
      {
        name: "Ethical Production",
        description: "Focuses on fair trade / ethical manufacturing.",
        prompt:
          "Emphasize ethical aspects like fair labor, local production, or give-back programs if present in the data. Stay factual and restrained.",
        sample: "Explains how the product aligns with ethical practices.",
        tags: ["ethical", "fair-trade", "values"],
      },
      {
        name: "Long-Life Design",
        description: "Durable, repairable positioning.",
        prompt:
          "Focus on durability, timeless style and ease of care or repair. Position the product as something bought less often but used for longer.",
        sample: "Frames purchase as an investment piece.",
        tags: ["durable", "timeless", "repairable"],
      },
      {
        name: "Refill & Repeat",
        description: "Consumable/refill workflow.",
        prompt:
          "Emphasize refills, reduced waste and convenience of reordering. Make it clear how the refill or repeat purchase works without overselling.",
        sample: "Explains how to keep supplies topped off.",
        tags: ["refill", "consumable", "routine"],
      },
      {
        name: "Seasonal / Drop",
        description: "Limited capsules or seasonal releases.",
        prompt:
          "Tie the product to the current season or capsule collection if that info is provided. Mention limited availability lightly, without aggressive FOMO.",
        sample: "Adds soft urgency tied to timing or drop.",
        tags: ["seasonal", "drop", "limited"],
      },
      {
        name: "Value-Aligned Story",
        description: "Connects to brand values or mission.",
        prompt:
          "Reflect the brand's stated values (e.g., inclusivity, creativity, local culture) in a subtle way. One short line connecting the product to those values is enough.",
        sample: "Connects the product to cause or community.",
        tags: ["values", "mission", "purpose"],
      },
    ],
  },
];


const PAGE_SIZE = 10;
const PRODUCTS_PAGE_SIZE = 50;

const PRODUCTS_QUERY = `#graphql
  query BulkGenerationProducts($first: Int!, $cursor: String) {
    products(first: $first, after: $cursor) {
      edges {
        cursor
        node {
          id
          title
          status
          handle
          productType
          vendor
          tags
          descriptionHtml
          options {
            name
            values
          }
          variants(first: 25) {
            edges {
              node {
                id
                title
                sku
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          collections(first: 10) {
            edges {
              node {
                id
                title
                handle
              }
            }
          }
          metafields(first: 20) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
          seo {
            title
            description
          }
          featuredImage {
            url
            altText
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

const fetchAllProductNodes = async (admin) => {
  const nodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: PRODUCTS_PAGE_SIZE, cursor },
    });
    const json = await response.json();
    const edges = json?.data?.products?.edges ?? [];
    edges.forEach((edge) => {
      if (edge?.node) {
        nodes.push(edge.node);
      }
    });
    hasNextPage = Boolean(json?.data?.products?.pageInfo?.hasNextPage);
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
    if (hasNextPage && !cursor) {
      hasNextPage = false;
    }
  }

  return nodes;
};
const TABLE_SCROLL_THRESHOLD = 10;
const TABLE_ROW_HEIGHT_PX = 64;
const TABLE_HEADER_HEIGHT_PX = 56;
const TABLE_MAX_HEIGHT_PX =
  TABLE_HEADER_HEIGHT_PX + TABLE_ROW_HEIGHT_PX * TABLE_SCROLL_THRESHOLD;
const TABLE_CHECKBOX_COLUMN_STYLE = {
  width: "48px",
  minWidth: "48px",
  padding: "0 8px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const hostParam = url.searchParams.get("host") || null;

  try {
    const productNodes = await fetchAllProductNodes(admin);
    const products =
      productNodes?.map((node) => {
        const options =
          node.options?.map((option) => ({
            name: option?.name,
            values: option?.values || [],
          })) || [];
        const variants =
          node.variants?.edges?.map(({ node: variant }) => ({
            id: variant.id,
            title: variant.title,
            sku: variant.sku,
            selectedOptions: variant.selectedOptions || [],
          })) || [];
        const collections =
          node.collections?.edges?.map(({ node: collection }) => ({
            id: collection.id,
            title: collection.title,
            handle: collection.handle,
          })) || [];
        return {
          id: node.id,
          title: node.title,
          status: node.status,
          short: node.productType || "Untyped",
          rating: rateProductContent(node),
          image: node.featuredImage?.url || "",
          altText: node.featuredImage?.altText || node.title,
          rawProduct: {
            id: node.id,
            title: node.title,
            handle: node.handle,
            vendor: node.vendor,
            product_type: node.productType,
            tags: node.tags || [],
            options,
            variants,
            collections,
            body_html: node.descriptionHtml || "",
            metafields: normalizeMetafields(node.metafields?.edges || []),
            seo: {
              title: node.seo?.title || "",
              description: node.seo?.description || "",
            },
          },
        };
      }) ?? [];

    const activeJob = await prisma.bulkJob.findFirst({
      where: { shopDomain, status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "desc" },
    });
    const creditRecord = await getOrCreateShopCredit(shopDomain);
    const planId = creditRecord?.currentPlan || DEFAULT_PLAN;
    return {
      products,
      hasActiveJob: Boolean(activeJob),
      activeJobId: activeJob?.id ?? null,
      hostParam,
      creditBalance: creditRecord?.creditsBalance ?? 0,
      planId,
    };
  } catch (error) {
    console.error("Failed to load products for bulk generation", error);
    return {
      products: [],
      hasActiveJob: false,
      activeJobId: null,
      hostParam,
      creditBalance: 0,
      planId: DEFAULT_PLAN,
    };
  }
};

export default function BulkGenerationPage() {
  const {
    products,
    hasActiveJob: initialHasActiveJob = false,
    activeJobId: initialActiveJobId = null,
    hostParam,
    creditBalance = 0,
    planId: initialPlanId = DEFAULT_PLAN,
  } = useLoaderData();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const isMountedRef = useRef(true);
  const [embeddedHost, setEmbeddedHost] = useState(() => hostParam || null);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (embeddedHost) {
      window.sessionStorage.setItem(HOST_STORAGE_KEY, embeddedHost);
      return;
    }
    const storedHost = window.sessionStorage.getItem(HOST_STORAGE_KEY);
    if (storedHost) {
      setEmbeddedHost(storedHost);
      return;
    }
    const hostFromUrl = new URLSearchParams(window.location.search).get("host");
    if (hostFromUrl) {
      setEmbeddedHost(hostFromUrl);
    }
  }, [embeddedHost]);
  const withHost = useCallback(
    (path) => {
      let host = embeddedHost;
      if (!host && typeof window !== "undefined") {
        host =
          window.sessionStorage.getItem(HOST_STORAGE_KEY) ||
          new URLSearchParams(window.location.search).get("host");
        if (host && !embeddedHost) {
          setEmbeddedHost(host);
        }
      }
      if (!host) return path;
      const separator = path.includes("?") ? "&" : "?";
      return `${path}${separator}host=${encodeURIComponent(host)}`;
    },
    [embeddedHost],
  );
  const productRows = useMemo(
    () => (products.length ? products : fallbackProductRows),
    [products],
  );
  const productLookup = useMemo(() => {
    const map = new Map();
    productRows.forEach((product) => {
      map.set(product.id, product);
    });
    return map;
  }, [productRows]);
  const generationTypeLookup = useMemo(() => {
    return generationTypes.reduce((acc, type) => {
      acc[type.id] = type;
      return acc;
    }, {});
  }, []);
  const [resourceTab, setResourceTab] = useState("products");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [pageByTab, setPageByTab] = useState({ products: 1, collections: 1 });
  const [selectedTypes, setSelectedTypes] = useState(generationTypes.map((type) => type.id));
  const [planId, setPlanId] = useState(initialPlanId);
  useEffect(() => {
    setPlanId(initialPlanId);
  }, [initialPlanId]);
  const planConfig = PLAN_CONFIG[planId] || PLAN_CONFIG[DEFAULT_PLAN];
  const maxProductsPerJob = planConfig?.maxProductsPerJob ?? Infinity;
  const selectedFields = useMemo(
    () =>
      selectedTypes
        .map((typeId) => PRODUCT_FIELD_NAME_BY_TYPE[typeId] || null)
        .filter(Boolean),
    [selectedTypes],
  );
  const [language, setLanguage] = useState("English");
  const [tone, setTone] = useState(creativeTones[0]?.value || "neutral");
  const [customInstructions, setCustomInstructions] = useState({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [templateModal, setTemplateModal] = useState({ open: false, typeId: null });
  const [templateCategoryIndex, setTemplateCategoryIndex] = useState(0);
  const [selectedTemplateDetails, setSelectedTemplateDetails] = useState(null);
  const [selectedTemplatesByType, setSelectedTemplatesByType] = useState({});
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [hasActiveJob, setHasActiveJob] = useState(initialHasActiveJob);
  const [activeJobId, setActiveJobId] = useState(initialActiveJobId);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeJobId || !embeddedHost) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(withHost(`/app/api/jobs/${activeJobId}`), {
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        });
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("application/json")) {
          throw new Error("Failed to fetch job status");
        }
        const data = await response.json();
        const status = data?.job?.status;
        if (status === "queued" || status === "running") {
          setHasActiveJob(true);
          if (!cancelled) {
            setTimeout(poll, 5000);
          }
        } else {
          setHasActiveJob(false);
          setActiveJobId(null);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to poll job status", error);
          setTimeout(poll, 7000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [activeJobId, embeddedHost, withHost]);

  const activeTemplateCategory =
    templateCategories[templateCategoryIndex] ?? templateCategories[0];

  const filteredProductRows = useMemo(() => {
    const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      return productRows;
    }
    return productRows.filter((row) => {
      const descriptionSource =
        row.rawProduct?.body_html || row.short || row.description || "";
      const searchableFields = [
        row.title,
        row.short,
        row.status,
        row.vendor,
        row.productType,
        row.product_type,
        Array.isArray(row.tags) ? row.tags.join(" ") : "",
        stripHtmlTags(descriptionSource),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => searchableFields.includes(token));
    });
  }, [productRows, searchQuery]);
  const currentRows = resourceTab === "products" ? filteredProductRows : collectionRows;
  const selection = resourceTab === "products" ? selectedProducts : selectedCollections;
  const productSelectionLimitReached =
    resourceTab === "products" && selectedProducts.length >= maxProductsPerJob;
  const totalPages = Math.max(1, Math.ceil(currentRows.length / PAGE_SIZE));
  const currentPage = Math.min(pageByTab[resourceTab], totalPages);
  const pagedRows = currentRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const shouldClampRows = pagedRows.length > TABLE_SCROLL_THRESHOLD;

  useEffect(() => {
    setSelectedProducts((current) => {
      const validIds = productRows.map((product) => product.id);
      const filtered = current.filter((id) => validIds.includes(id));
      if (!filtered.length && validIds.length) {
        const defaults =
          maxProductsPerJob === Infinity
            ? validIds
            : validIds.slice(0, maxProductsPerJob);
        return defaults;
      }
      if (maxProductsPerJob !== Infinity && filtered.length > maxProductsPerJob) {
        return filtered.slice(0, maxProductsPerJob);
      }
      return filtered;
    });
  }, [productRows, maxProductsPerJob]);

  const toggleType = (typeId) => {
    setSelectedTypes((current) =>
      current.includes(typeId)
        ? current.filter((id) => id !== typeId)
        : [...current, typeId],
    );
  };

  const totalSelectedTargets = selectedProducts.length + selectedCollections.length;
  const totalWorkItems = calculateWorkItems(totalSelectedTargets, selectedFields);
  const insufficientCredits = totalWorkItems > 0 && creditBalance < totalWorkItems;
  const creditShortfall = insufficientCredits ? totalWorkItems - creditBalance : 0;

  const handleCustomToggle = (typeId) => {
    setCustomInstructions((current) => {
      const existing = current[typeId] || { text: "" };
      return {
        ...current,
        [typeId]: {
          ...existing,
          enabled: true,
        },
      };
    });
  };

  const handleInstructionChange = (typeId, value) => {
    setCustomInstructions((current) => ({
      ...current,
      [typeId]: {
        ...current[typeId],
        enabled: true,
        text: value,
      },
    }));
  };

  const clearCustomInstructions = (typeId) => {
    setCustomInstructions((current) => ({
      ...current,
      [typeId]: {
        text: "",
        enabled: false,
      },
    }));
  };

  useEffect(() => {
    setPageByTab((current) => {
      const adjusted = Math.min(current[resourceTab], totalPages);
      return current[resourceTab] === adjusted
        ? current
        : { ...current, [resourceTab]: adjusted };
    });
  }, [resourceTab, totalPages]);

  useEffect(() => {
    if (resourceTab !== "products") {
      return;
    }
    setPageByTab((current) => {
      if (current.products === 1) {
        return current;
      }
      return { ...current, products: 1 };
    });
  }, [resourceTab, searchQuery]);

  const notifyPlanLimit = () => {
    if (maxProductsPerJob === Infinity) {
      return;
    }
    shopify.toast.show?.(
      `Your ${planConfig.title} plan supports up to ${maxProductsPerJob.toLocaleString()} products per bulk job.`,
    );
  };

  const toggleResource = (id) => {
    if (resourceTab === "products") {
      setSelectedProducts((current) => {
        if (current.includes(id)) {
          return current.filter((value) => value !== id);
        }
        if (maxProductsPerJob !== Infinity && current.length >= maxProductsPerJob) {
          notifyPlanLimit();
          return current;
        }
        return [...current, id];
      });
      return;
    }
    setSelectedCollections((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const toggleAll = () => {
    const rowIds = currentRows.map((row) => row.id);
    if (resourceTab === "products") {
      const isAllSelected = rowIds.every((rowId) => selectedProducts.includes(rowId));
      if (isAllSelected) {
        setSelectedProducts((current) => current.filter((id) => !rowIds.includes(id)));
        return;
      }
      setSelectedProducts((current) => {
        const merged = Array.from(new Set([...current, ...rowIds]));
        if (maxProductsPerJob !== Infinity && merged.length > maxProductsPerJob) {
          notifyPlanLimit();
          return merged.slice(0, maxProductsPerJob);
        }
        return merged;
      });
      return;
    }
    const isAllCollectionsSelected = rowIds.every((rowId) => selectedCollections.includes(rowId));
    setSelectedCollections(
      isAllCollectionsSelected
        ? selectedCollections.filter((id) => !rowIds.includes(id))
        : Array.from(new Set([...selectedCollections, ...rowIds])),
    );
  };

  const clearSelection = () => {
    if (resourceTab === "products") {
      setSelectedProducts([]);
    } else {
      setSelectedCollections([]);
    }
  };

  const changePage = (direction) => {
    setPageByTab((current) => {
      const page = Math.min(current[resourceTab], totalPages);
      const nextPage = Math.min(
        totalPages,
        Math.max(1, page + direction),
      );
      return { ...current, [resourceTab]: nextPage };
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (hasActiveJob) {
      shopify.toast.show?.("Wait for the current job to finish before starting another.");
      return;
    }
    if (isGeneratingContent) {
      return;
    }
    const totalSelected = selectedProducts.length;
    if (!totalSelected || selectedFields.length === 0) {
      shopify.toast.show?.("Select at least one product and output type.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const toneValue = formData.get("tone") || tone;
    const languageValue = formData.get("language") || language;
    const toneConfig = creativeTones.find((option) => option.value === toneValue) || creativeTones[0];
    const toneSnippet =
      toneConfig?.snippet || "Use a clear, neutral ecommerce tone. Concise, professional, no jokes, no hype.";
    const blockedTermInput = formData.get("blockedTerms") || "";
    const blockedTerms = blockedTermInput
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);

    if (selectedFields.length === 0) {
      shopify.toast.show?.("Choose at least one supported output.");
      return;
    }

    const productsToGenerate = selectedProducts
      .map((productId) => productLookup.get(productId))
      .filter((product) => product?.rawProduct);

    if (productsToGenerate.length === 0) {
      shopify.toast.show?.("Selected products are missing data for generation.");
      return;
    }

    const customInstructionPayload = Object.entries(customInstructions).reduce((acc, [typeId, state]) => {
      if (!state?.enabled || !state?.text) {
        return acc;
      }
      const field = PRODUCT_FIELD_NAME_BY_TYPE[typeId];
      if (field) {
        acc[field] = state.text.trim();
      }
      return acc;
    }, {});

    const templatePayload = Object.entries(selectedTemplatesByType).reduce((acc, [typeId, template]) => {
      if (!template) {
        return acc;
      }
        const field = PRODUCT_FIELD_NAME_BY_TYPE[typeId];
        if (field) {
          acc[field] = {
            name: template.name,
          prompt: template.prompt,
        };
      }
      return acc;
    }, {});

    const settingsPayload = {
      language: languageValue,
      fields: selectedFields,
      tone_snippet: toneSnippet,
      blocked_terms: blockedTerms,
      custom_instructions: customInstructionPayload,
      templates: templatePayload,
      max_lengths: {
        title: 70,
        meta_title: 60,
        meta_description: 155,
      },
    };

    setIsGeneratingContent(true);
    fetch(withHost("/app/jobs/create"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productIds: productsToGenerate.map((product) => product.id),
        settings: {
          ...settingsPayload,
          fields: selectedFields,
        },
      }),
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorJson = await response.json().catch(() => null);
          throw new Error(errorJson?.error || "Failed to queue job.");
        }
        const { jobId } = await response.json();
        setHasActiveJob(true);
        setActiveJobId(jobId || null);
        shopify.toast.show?.("Bulk job queued. Track progress on the home page.");
        navigate(
          embeddedHost ? `/app?host=${encodeURIComponent(embeddedHost)}` : "/app",
        );
      })
      .catch((error) => {
        console.error("Failed to queue job", error);
        shopify.toast.show?.(error?.message || "Unable to start job.");
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsGeneratingContent(false);
        }
      });
  };

  return (
    <>
      <s-page heading="Bulk generation">
        <s-stack direction="block" gap="base">
          {hasActiveJob && (
            <s-banner tone="warning" heading="Generation in progress">
              Finish reviewing the current job in Order history before queueing another run.
            </s-banner>
          )}

            <s-section
              heading="Select products"
              description={
                maxProductsPerJob === Infinity
                  ? undefined
                  : `Your plan allows up to ${maxProductsPerJob.toLocaleString()} products per bulk job.`
              }
            >
            <s-stack direction="block" gap="base">
                {/* Resource tabs */}
                <s-button-group>
                  <s-button
                    variant={resourceTab === "products" ? "primary" : "tertiary"}
                    onClick={() => setResourceTab("products")}
                  >
                    Products
                  </s-button>
                  <s-button
                    variant={resourceTab === "collections" ? "primary" : "tertiary"}
                    onClick={() => setResourceTab("collections")}
                  >
                    Collections
                  </s-button>
                </s-button-group>


                {/* Table */}
                <s-section padding="none" accessibilityLabel="Resource selection table">
                  {resourceTab === "products" ? (
                    <div
                      style={{
                        border: "1px solid var(--p-color-border-subdued, #D0D5DD)",
                        borderRadius: "12px",
                        overflow: "hidden",
                      }}
                    >
                      <s-table>
                        <s-grid
                          slot="filters"
                          gap="small-200"
                          gridTemplateColumns="minmax(220px, 2fr) auto"
                          style={{ alignItems: "center" }}
                        >
                          <s-text-field
                            name="product-search"
                            label="Search products"
                            labelAccessibilityVisibility="exclusive"
                            icon="search"
                            placeholder="Search titles, vendors, or tags"
                            value={searchQuery}
                            onInput={(event) => setSearchQuery(event.target.value)}
                          ></s-text-field>
                          <s-button
                            icon="eraser"
                            type="button"
                            variant="primary"
                            size="slim"
                            onClick={clearSelection}
                            disabled={selection.length === 0}
                          >
                            {selection.length === 0
                              ? "0 selected"
                              : `${selection.length} selected · Clear`}
                          </s-button>
                        </s-grid>
                        {resourceTab === "products" && maxProductsPerJob !== Infinity && (
                          <s-text
                            tone={productSelectionLimitReached ? "critical" : "subdued"}
                            size="small"
                            style={{ padding: "0 1rem" }}
                          >
                            Plan limit: up to {maxProductsPerJob.toLocaleString()} products per bulk job.
                          </s-text>
                        )}

                        <s-table-header-row>
                          <s-table-header>
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                              }}
                            >
                              <input
                                type="checkbox"
                                onChange={toggleAll}
                                checked={
                                  currentRows.length > 0 &&
                                  currentRows.every((row) => selection.includes(row.id))
                                }
                                aria-label="Select all rows in this page"
                                ref={(input) => {
                                  if (!input) return;
                                  const someSelected =
                                    selection.length > 0 && selection.length < currentRows.length;
                                  input.indeterminate = someSelected;
                                }}
                              />
                              Product
                            </span>
                          </s-table-header>
                          <s-table-header>Quality rating</s-table-header>
                        </s-table-header-row>

                        <s-table-body>
                          {pagedRows.length === 0 ? (
                            <s-table-row>
                              <s-table-cell colSpan="2">
                                <s-stack
                                  direction="block"
                                  gap="tight"
                                  align="center"
                                  style={{ padding: "1rem 0" }}
                                >
                                  <s-icon type="search" tone="subdued" />
                                  <s-text appearance="subdued">
                                    No products match your filters.
                                  </s-text>
                                </s-stack>
                              </s-table-cell>
                            </s-table-row>
                          ) : (
                            pagedRows.map((row) => {
                              const descriptionSource =
                                row.rawProduct?.body_html || row.short || row.description || "";
                              const descriptionText =
                                truncateText(stripHtmlTags(descriptionSource)) ||
                                "No description available";
                              const isSelected = selection.includes(row.id);

                              return (
                                <s-table-row
                                  key={row.id}
                                  style={{
                                    backgroundColor: isSelected
                                      ? "var(--p-color-bg-surface-hover)"
                                      : "transparent",
                                    cursor: "pointer",
                                  }}
                                  onClick={(event) => {
                                    const target = event.target;
                                    if (
                                      target instanceof HTMLElement &&
                                      (target.closest("input") ||
                                        target.closest("button") ||
                                        target.closest("a"))
                                    ) {
                                      return;
                                    }
                                  if (!productSelectionLimitReached || isSelected) {
                                    toggleResource(row.id);
                                  }
                                }}
                              >
                                <s-table-cell>
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "0.75rem",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={
                                          !isSelected &&
                                          productSelectionLimitReached &&
                                          resourceTab === "products"
                                        }
                                        onChange={() => {
                                          if (!isSelected) {
                                            if (productSelectionLimitReached) {
                                              shopify.toast.show?.(
                                                `Your plan allows ${maxProductsPerJob.toLocaleString()} products per bulk job.`,
                                              );
                                              return;
                                            }
                                            toggleResource(row.id);
                                          } else {
                                            toggleResource(row.id);
                                          }
                                        }}
                                        aria-label={`Select ${row.title}`}
                                      />
                                      <div
                                        style={{
                                          width: 48,
                                          height: 48,
                                          borderRadius: 10,
                                          backgroundColor: "#f4f6f8",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          overflow: "hidden",
                                          flexShrink: 0,
                                        }}
                                      >
                                        {row.image ? (
                                          <img
                                            src={row.image}
                                            alt={row.altText || row.title}
                                            width="48"
                                            height="48"
                                            loading="lazy"
                                            style={{ objectFit: "cover" }}
                                          />
                                        ) : (
                                          <s-icon type="image" tone="subdued" />
                                        )}
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "0.2rem",
                                          minWidth: 0,
                                        }}
                                      >
                                        <s-text type="strong" truncate>
                                          {row.title}
                                        </s-text>
                                        <s-text appearance="subdued" size="small">
                                          {descriptionText}
                                        </s-text>
                                      </div>
                                    </div>
                                  </s-table-cell>
                                  <s-table-cell>
                                    {row.rating != null ? (
                                      <s-badge
                                        tone={getRatingTone(row.rating)}
                                        appearance="subdued"
                                      >
                                        {row.rating.toFixed(1)} / 10
                                      </s-badge>
                                    ) : (
                                      <s-text appearance="subdued">Not rated</s-text>
                                    )}
                                  </s-table-cell>
                                </s-table-row>
                              );
                            })
                          )}
                        </s-table-body>
                      </s-table>
                    </div>
                  ) : (
                    <div
                      style={{
                        border: "1px solid var(--p-color-border-subdued, #D0D5DD)",
                        borderRadius: "8px",
                        overflowX: "hidden",
                        overflowY: shouldClampRows ? "auto" : "hidden",
                        maxHeight: shouldClampRows ? `${TABLE_MAX_HEIGHT_PX}px` : "none",
                      }}
                    >
                      <s-table>
                        <s-table-header-row>
                          <s-table-header listSlot="inline" style={TABLE_CHECKBOX_COLUMN_STYLE}>
                            <input
                              type="checkbox"
                              onChange={toggleAll}
                              checked={
                                currentRows.length > 0 &&
                                currentRows.every((row) => selection.includes(row.id))
                              }
                              aria-label="Select all rows in this page"
                              ref={(input) => {
                                if (!input) return;
                                const someSelected =
                                  selection.length > 0 && selection.length < currentRows.length;
                                input.indeterminate = someSelected;
                              }}
                            />
                          </s-table-header>
                          <s-table-header listSlot="primary">Collection</s-table-header>
                          <s-table-header listSlot="secondary">Description</s-table-header>
                          <s-table-header listSlot="labeled">Details</s-table-header>
                        </s-table-header-row>

                        <s-table-body>
                          {pagedRows.map((row) => {
                            const descriptionSource = row.short || row.description || "";
                            const descriptionText =
                              truncateText(stripHtmlTags(descriptionSource)) ||
                              "No description available";
                            const isSelected = selection.includes(row.id);

                            return (
                              <s-table-row
                                key={row.id}
                                style={{
                                  backgroundColor: isSelected
                                    ? "var(--p-color-bg-surface-hover)"
                                    : "transparent",
                                  cursor: "pointer",
                                }}
                                onClick={(event) => {
                                  const target = event.target;
                                  if (target instanceof HTMLInputElement) {
                                    return;
                                  }
                                  toggleResource(row.id);
                                }}
                              >
                                <s-table-cell style={TABLE_CHECKBOX_COLUMN_STYLE}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleResource(row.id)}
                                    aria-label={`Select ${row.title}`}
                                  />
                                </s-table-cell>

                                <s-table-cell>
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 12,
                                    }}
                                  >
                                    {row.image ? (
                                      <img
                                        src={row.image}
                                        alt={row.title}
                                        width="40"
                                        height="40"
                                        loading="lazy"
                                        style={{
                                          borderRadius: 6,
                                          objectFit: "cover",
                                          display: "block",
                                          flexShrink: 0,
                                        }}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          width: 40,
                                          height: 40,
                                          borderRadius: 6,
                                          backgroundColor: "#f4f6f8",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          flexShrink: 0,
                                        }}
                                      >
                                        <s-icon source="ImageMajor" />
                                      </div>
                                    )}

                                    <div
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 2,
                                        minWidth: 0,
                                      }}
                                    >
                                      <s-link href="#" truncate>
                                        {row.title}
                                      </s-link>
                                    </div>
                                  </div>
                                </s-table-cell>

                                <s-table-cell>
                                  <s-text tone="subdued" truncate>
                                    {descriptionText}
                                  </s-text>
                                </s-table-cell>

                                <s-table-cell>
                                  <s-badge tone="attention" appearance="subdued">
                                    {row.short}
                                  </s-badge>
                                </s-table-cell>
                              </s-table-row>
                            );
                          })}
                        </s-table-body>
                      </s-table>
                    </div>
                  )}
                </s-section>

                {/* Pagination */}
                <s-stack direction="block" align="center" style={{ gap: "0.5rem" }}>
                  <s-pagination
                    has-previous={currentPage > 1}
                    has-next={currentPage < totalPages}
                    label={`Page ${currentPage} of ${totalPages}`}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      gap: "0.75rem",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <s-button
                      slot="previous"
                      variant="secondary"
                      onClick={() => changePage(-1)}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </s-button>

                    <s-stack direction="inline" gap="extra-tight" align="center">
                      {Array.from({ length: totalPages }).map((_, index) => {
                        const pageNumber = index + 1;
                        const isCurrent = pageNumber === currentPage;

                        return (
                          <s-button
                            key={pageNumber}
                            size="slim"
                            variant={isCurrent ? "primary" : "tertiary"}
                            onClick={() =>
                              setPageByTab((current) => ({
                                ...current,
                                [resourceTab]: pageNumber,
                              }))
                            }
                          >
                            {pageNumber}
                          </s-button>
                        );
                      })}
                    </s-stack>

                    <s-button
                      slot="next"
                      variant="secondary"
                      onClick={() => changePage(1)}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </s-button>
                  </s-pagination>
                </s-stack>
              </s-stack>
            </s-section>

          <s-section heading="Generation details">
        <form onSubmit={handleSubmit}>
          <s-stack direction="block" gap="base">
            <s-card>
              <s-form-layout>
                <s-select
                  label="Output language"
                  name="language"
                  value={language}
                  onInput={(event) => setLanguage(event.target.value)}
                >
                  {languages.map((languageOption) => (
                    <s-option key={languageOption} value={languageOption}>
                      {languageOption}
                    </s-option>
                  ))}
                </s-select>
              </s-form-layout>
            </s-card>

            {selectedFields.length === 0 && (
              <s-banner tone="warning" heading="Choose at least one content output">
                Toggle the checkboxes on the cards below to include the outputs you want generated.
              </s-banner>
            )}

            <s-stack direction="block" gap="base">
              {generationTypes.map((type) => {
                const typeId = type.id;
                const customState = customInstructions[typeId] || {};
                const modalId = `custom-instructions-${typeId}`;
                const switchId = `generation-type-${typeId}`;
                const instructionsEnabled = !!customState.enabled;
                const isSelected = selectedTypes.includes(typeId);
                const templateDetails = selectedTemplatesByType[typeId];
                const hasTemplate = !!templateDetails?.name;
                const instructionsBlocked = hasTemplate && !instructionsEnabled;
                const instructionsButtonDisabled = !isSelected || instructionsBlocked;
                const browseTemplatesDisabled = !isSelected || instructionsEnabled;
                return (
                  <s-box
                    key={typeId}
                    padding="base"
                    background="subdued"
                    border="base"
                    borderRadius="base"
                    style={{
                      opacity: isSelected ? 1 : 0.6,
                      transition: "opacity 150ms ease",
                    }}
                  >
                    <s-stack direction="block" gap="tight">
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.75rem",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            flexWrap: "wrap",
                          }}
                        >
                          <s-switch
                            id={switchId}
                            checked={isSelected}
                            onInput={() => toggleType(typeId)}
                          ></s-switch>
                            <s-stack gap="none">
                            <s-text type="strong">{type?.label ?? typeId}</s-text>
                            <s-text>{type?.description ?? typeId}</s-text>
                          </s-stack>
                        </div>

                        {isSelected && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                              flexWrap: "wrap",
                            }}
                          >
                            <s-stack gap="base">

                            {hasTemplate && (
                              <s-badge tone="success">
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.3rem",
                                  }}
                                >
                                  Template: {templateDetails.name}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${templateDetails.name} template`}
                                    onClick={() =>
                                      setSelectedTemplatesByType((current) => {
                                        const next = { ...current };
                                        delete next[typeId];
                                        return next;
                                      })
                                    }
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      padding: 0,
                                      margin: 0,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      cursor: "pointer",
                                      color: "inherit",
                                    }}
                                  >
                                    <s-icon type="x" size="small"></s-icon>
                                  </button>
                                </span>
                              </s-badge>
                            )}

                            <s-button
                              type="button"
                              variant="primary"
                              disabled={browseTemplatesDisabled}
                              onClick={() => setTemplateModal({ open: true, typeId })}
                            >
                              Browse templates
                            </s-button>

                            {!hasTemplate && (
                              <s-button
                                type="button"
                                variant="secondary"
                                size="slim"
                                commandFor={modalId}
                                disabled={instructionsButtonDisabled}
                              >
                                {instructionsEnabled
                                  ? "Edit custom instructions"
                                  : "Custom instructions"}
                              </s-button>
                            )}
                          </s-stack>

                          </div>
                        )}
                      </div>

                      {isSelected && !hasTemplate && (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-start",
                          }}
                        >

                        </div>
                      )}

                      {isSelected && (!templateDetails?.name || instructionsEnabled) && (
                        <>


                          <s-modal id={modalId} heading={`${type?.label ?? typeId} instructions`}>
                            <s-paragraph>
                              Provide detailed guidance for this content type. We&apos;ll apply it whenever this type is generated.
                            </s-paragraph>
                            <s-text-area
                              label="Custom instruction details"
                              name={`instructions-${typeId}`}
                              rows={4}
                              value={customState.text || ""}
                              onInput={(event) => handleInstructionChange(typeId, event.target.value)}
                            ></s-text-area>

                            <s-button
                              slot="secondary-actions"
                              variant="tertiary"
                              commandFor={modalId}
                              command="--hide"
                              onClick={() => clearCustomInstructions(typeId)}
                            >
                              Clear
                            </s-button>
                            <s-button
                              slot="primary-action"
                              variant="primary"
                              commandFor={modalId}
                              command="--hide"
                              onClick={() => handleCustomToggle(typeId)}
                            >
                              Save
                            </s-button>
                          </s-modal>
                        </>
                      )}

                      {isSelected && instructionsEnabled && (
                        <s-banner tone="info" heading="Custom instructions enabled">
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "0.5rem",
                            }}
                          >
                            <s-text appearance="subdued">
                              We&apos;ll apply these directions every time we generate this output.
                            </s-text>
                            <s-button
                              icon="eraser"
                              variant="destructive"
                              size="slim"
                              onClick={() => clearCustomInstructions(typeId)}
                            >
                              Delete instructions
                            </s-button>
                          </div>
                        </s-banner>
                      )}

                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>

            <s-card>
              <s-stack direction="block" gap="base">
                <s-button
                icon="settings"
                  type="button"
                  variant="secondary"
                  onClick={() => setShowAdvanced((value) => !value)}
                >
                  {showAdvanced ? "Hide advanced settings" : "Show advanced settings"}
                </s-button>

                {showAdvanced && (
                  <s-stack direction="block" gap="base">
                    <s-stack direction="block" gap="tight">
                      <>
                        <s-tooltip id="creative-tone-tooltip">
                          Choose the voice style you want the AI to use.
                        </s-tooltip>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <s-text type="strong">Creative tone</s-text>
                          <s-button
                            interestFor="creative-tone-tooltip"
                            accessibilityLabel="Learn about creative tones"
                          >
                            ?
                          </s-button>
                        </div>
                      </>
                      <s-select
                        label="Creative tone"
                        name="tone"
                        value={tone}
                        onInput={(event) => setTone(event.target.value)}
                      >
                        {creativeTones.map((toneOption) => (
                          <s-option key={toneOption.value} value={toneOption.value}>
                            {toneOption.label}
                          </s-option>
                        ))}
                      </s-select>
                    </s-stack>
                    <s-stack direction="block" gap="tight">
                      <>
                        <s-tooltip id="blocked-terms-tooltip">
                          Example: cheap, crazy, insane, limited-time only
                        </s-tooltip>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <s-text type="strong">Words to avoid</s-text>
                          <s-button interestFor="blocked-terms-tooltip" accessibilityLabel="See examples">
                            ?
                          </s-button>
                        </div>
                      </>
                      <s-text-area
                        label="Words to avoid"
                        name="blockedTerms"
                        rows={3}
                        placeholder="Add comma separated phrases"
                      ></s-text-area>
                    </s-stack>
                 </s-stack>
               )}
             </s-stack>
           </s-card>

            {insufficientCredits && (
              <s-text tone="critical">
                Insufficient credits. Please add more to continue.
                {creditShortfall > 0
                  ? ` You need ${creditShortfall} more credit${creditShortfall === 1 ? "" : "s"}.`
                  : ""}
              </s-text>
            )}

                        <s-banner heading="Generation summary" tone="info">
                        {totalSelectedTargets > 0 && selectedFields.length > 0 && (
              <s-text appearance="subdued" size="small">
                {totalSelectedTargets} {totalSelectedTargets === 1 ? "product" : "products"}
                {" \u00B7 "}
                {selectedFields.length} {selectedFields.length === 1 ? "field" : "fields"} selected
                {" \u00B7 "}
                Estimated {totalWorkItems} credit{totalWorkItems === 1 ? "" : "s"}
              </s-text>
            )}
            </s-banner>

            <s-button
            icon="wand" 
              type="submit"
              variant="primary"
              disabled={
                totalSelectedTargets === 0 ||
                selectedFields.length === 0 ||
                isGeneratingContent ||
                hasActiveJob ||
                insufficientCredits
              }
              {...(isGeneratingContent ? { loading: true } : {})}
            >
              {isGeneratingContent
                ? "Generating..."
                : totalSelectedTargets > 0
                  ? `Generate content for ${totalSelectedTargets} ${
                      totalSelectedTargets === 1 ? "product" : "products"
                    }`
                  : "Generate content"}
            </s-button>
          </s-stack>
        </form>
      </s-section>

        </s-stack>
      </s-page>
      {templateModal.open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.45)",
            zIndex: 1000,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "min(960px, 100%)",
              background: "white",
              borderRadius: "16px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.15)",
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "20px 24px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <s-text variant="headingMd">
                    Templates for {generationTypeLookup[templateModal.typeId]?.label}
                  </s-text>
                  <s-text variant="bodySubdued">
                    Choose from curated prompt templates tuned for different goals.
                  </s-text>
                </div>
                <s-button onClick={() => setTemplateModal({ open: false, typeId: null })}>
                  Close
                </s-button>
              </div>
              <s-divider spacing="base"></s-divider>
            </div>
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              <div
                style={{
                  width: "240px",
                  borderRight: "1px solid #f0f1f2",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  overflowY: "auto",
                }}
              >
                {templateCategories.map((category, index) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => {
                      setTemplateCategoryIndex(index);
                      setSelectedTemplateDetails(null);
                    }}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: "12px",
                      border: "1px solid #dfe3e8",
                      background: index === templateCategoryIndex ? "#f6f6f7" : "white",
                      cursor: "pointer",
                      fontWeight: index === templateCategoryIndex ? 600 : 500,
                    }}
                  >
                    {category.title}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                {!selectedTemplateDetails && (
                  <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
                    <s-stack direction="inline" align="center" gap="tight">
                      <s-text type="strong">
                        Templates ({activeTemplateCategory.templates.length})
                      </s-text>
                    </s-stack>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                        gap: "16px",
                        marginTop: "16px",
                      }}
                    >
                      {activeTemplateCategory.templates.map((template) => (
                        <s-card
                          key={template.name}
                          style={{
                            background: "#fff",
                            border: "1px solid #dfe3e8",
                            borderRadius: "16px",
                            padding: "16px",
                          }}
                        >
                          <s-stack direction="block" gap="tight">
                            <s-text type="strong">
                              {template.name}
                            </s-text>
                            <s-text variant="bodySubdued">{template.description}</s-text>
                            <s-button-group>
                              <s-button
                                slot="secondary-actions"
                                type="button"
                                variant="tertiary"
                                onClick={() =>
                                  setSelectedTemplateDetails({
                                    category: activeTemplateCategory.title,
                                    ...template,
                                    sample:
                                      template.sample ||
                                      "Crafted for discerning shoppers, this prompt tells a short story about the product's origin, spotlighting materials and care instructions.",
                                    prompt:
                                      template.prompt ||
                                      `Outline a product story that covers
• the product's purpose and primary benefit,
• the maker or brand's credibility,
• 3-4 sensory or craftsmanship highlights, and
• guidance for caring for the item so it lasts.
Keep the tone confident, educational, and approachable.
Avoid mentioning specific brand names or celebrity endorsements.`,
                                    tags:
                                      template.tags || [
                                        "storytelling",
                                        "craftsmanship",
                                        "authenticity",
                                        "care tips",
                                      ],
                                    language: "English",
                                    length: "Concise",
                                  })
                                }
                              >
                                View details
                              </s-button>
                              <s-button
                                slot="primary-action"
                                type="button"
                                variant="primary"
                                onClick={() => {
                                  setSelectedTemplatesByType((current) => ({
                                    ...current,
                                    [templateModal.typeId]: template,
                                  }));
                                  setTemplateModal({ open: false, typeId: null });
                                }}
                              >
                                Use template
                              </s-button>
                            </s-button-group>
                          </s-stack>
                        </s-card>
                      ))}
                    </div>
                  </div>
                )}
                {selectedTemplateDetails && (
                  <div
                    style={{
                      flex: 1,
                      padding: "24px",
                      overflowY: "auto",
                      borderLeft: "1px solid #f0f1f2",
                      display: "flex",
                      flexDirection: "column",
                      gap: "16px",
                      background: "#fafafa",
                    }}
                  >
                    <s-button
                      type="button"
                      variant="tertiary"
                      onClick={() => setSelectedTemplateDetails(null)}
                    >
                      ← Back to templates
                    </s-button>

                    <s-card>
                      <s-text variant="headingMd">{selectedTemplateDetails.name}</s-text>
                      <pre
                        style={{
                          background: "#f6f6f7",
                          padding: "12px",
                          borderRadius: "12px",
                          whiteSpace: "pre-wrap",
                          marginTop: "12px",
                        }}
                      >
                        {selectedTemplateDetails.description}
                      </pre>
                    </s-card>

                    <s-card>
                      <s-text type="strong">Template prompt</s-text>
                      <pre
                        style={{
                          background: "#f6f6f7",
                          padding: "12px",
                          borderRadius: "12px",
                          whiteSpace: "pre-wrap",
                          marginTop: "12px",
                        }}
                      >
                        {selectedTemplateDetails.prompt}
                      </pre>
                    </s-card>

                    <s-card>
                      <s-text type="strong">Descriptions will look like this</s-text>
                      <pre
                        style={{
                          background: "#f6f6f7",
                          padding: "12px",
                          borderRadius: "12px",
                          whiteSpace: "pre-wrap",
                          marginTop: "12px",
                        }}
                      >
                        {selectedTemplateDetails.sample}
                      </pre>
                    </s-card>

                    <s-button
                      type="button"
                      variant="primary"
                      onClick={() => {
                        setSelectedTemplatesByType((current) => ({
                          ...current,
                          [templateModal.typeId]: selectedTemplateDetails,
                        }));
                        setTemplateModal({ open: false, typeId: null });
                        setSelectedTemplateDetails(null);
                      }}
                    >
                      Use template
                    </s-button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
