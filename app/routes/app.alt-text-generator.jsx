import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrCreateShopCredit } from "../server/shopCredit.server";
import { rateProductContent } from "../utils/productQuality";
import { calculateAltTextItems, clampImageTargetCount } from "../utils/creditMath";
import { PLAN_CONFIG, DEFAULT_PLAN } from "../utils/planConfig";

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
  imageCount: 1,
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

const generationTypes = [{ id: "altText", label: "Alt text" }];
const ALT_TEXT_FIELD_NAME_BY_TYPE = {
  altText: "alt_text",
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

const ALT_TEXT_PRODUCTS_QUERY = `#graphql
  query AltTextProducts($first: Int!, $cursor: String) {
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
          images(first: 50) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

const fetchAllProductNodesWithImages = async (admin) => {
  const nodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(ALT_TEXT_PRODUCTS_QUERY, {
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

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const hostParam = url.searchParams.get("host") || null;

  try {
    const productNodes = await fetchAllProductNodesWithImages(admin);
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
        const imageCount =
          Array.isArray(node.images?.edges) && node.images.edges.length > 0
            ? node.images.edges.length
            : node.featuredImage
              ? 1
              : 0;
        return {
          id: node.id,
          title: node.title,
          status: node.status,
          short: node.productType || "Untyped",
          rating: rateProductContent(node),
          image: node.featuredImage?.url || "",
          altText: node.featuredImage?.altText || node.title,
          imageCount,
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
    console.error("Failed to load products for alt text generator", error);
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

export default function AltTextGeneratorPage() {
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
  const [planId, setPlanId] = useState(initialPlanId);
  useEffect(() => {
    setPlanId(initialPlanId);
  }, [initialPlanId]);
  const planConfig = PLAN_CONFIG[planId] || PLAN_CONFIG[DEFAULT_PLAN];
  const maxProductsPerJob = planConfig?.maxProductsPerJob ?? Infinity;
  const [imageScope, setImageScope] = useState("main");
  const getImageTargetCount = useCallback(
    (productId) => {
      const product = productLookup.get(productId);
      const availableImages = Math.max(0, Number(product?.imageCount) || 0);
      if (availableImages === 0) {
        return 0;
      }
      if (imageScope === "all") {
        return availableImages;
      }
      return 1;
    },
    [productLookup, imageScope],
  );
  const imageCountsByProduct = useMemo(() => {
    return selectedProducts.reduce((acc, productId) => {
      acc[productId] = getImageTargetCount(productId);
      return acc;
    }, {});
  }, [selectedProducts, getImageTargetCount]);
  const productSelectionLimitReached =
    maxProductsPerJob !== Infinity && selectedProducts.length >= maxProductsPerJob;
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [pageByTab, setPageByTab] = useState({ products: 1, collections: 1 });
  const selectedTypes = generationTypes.map((type) => type.id);
  const language = "English";
  const tone = creativeTones[0]?.value || "neutral";
  const customInstructions = {};
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

  const filteredProductRows = useMemo(() => {
    const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.length
      ? productRows.filter((row) => {
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
        })
      : productRows;
  }, [productRows, searchQuery]);

  const currentRows = resourceTab === "products" ? filteredProductRows : collectionRows;
  const selection = resourceTab === "products" ? selectedProducts : selectedCollections;
  const totalPages = Math.max(1, Math.ceil(currentRows.length / PAGE_SIZE));
  const currentPage = Math.min(pageByTab[resourceTab], totalPages);
  const pagedRows = currentRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const activeTemplateCategory =
    templateCategories[templateCategoryIndex] ?? templateCategories[0];

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

  const totalSelectedTargets = selectedProducts.length;
  const totalImageTargets = useMemo(
    () =>
      calculateAltTextItems(selectedProducts, {
        image_counts: imageCountsByProduct,
        image_scope: imageScope,
      }),
    [selectedProducts, imageCountsByProduct, imageScope],
  );
  const totalWorkItems = totalImageTargets;
  const insufficientCredits = totalWorkItems > 0 && creditBalance < totalWorkItems;
  const creditShortfall = insufficientCredits ? totalWorkItems - creditBalance : 0;
  const totalMainImageTargets = useMemo(
    () =>
      selectedProducts.reduce((sum, productId) => {
        const product = productLookup.get(productId);
        const availableImages = Math.max(0, Number(product?.imageCount) || 0);
        if (availableImages === 0) {
          return sum;
        }
        return sum + 1;
      }, 0),
    [selectedProducts, productLookup],
  );
  const totalAllImageTargets = useMemo(
    () =>
      selectedProducts.reduce((sum, productId) => {
        const product = productLookup.get(productId);
        const availableImages = Math.max(0, Number(product?.imageCount) || 0);
        return sum + availableImages;
      }, 0),
    [selectedProducts, productLookup],
  );
  const formatImageCount = useCallback(
    (count) => `${count || 0} image${count === 1 ? "" : "s"}`,
    [],
  );
  const coverageOptions = [
    {
      id: "all",
      title: "All product images",
      description: "Generate alt text for every media asset on each product.",
      benefit: "Deep coverage keeps every gallery image accessible.",
      countLabel: formatImageCount(totalAllImageTargets),
      targetCount: totalAllImageTargets,
      icon: "collection-list",
      bestFor: "Full media refresh",
      accentTone: "info",
    },
    {
      id: "main",
      title: "Featured image only",
      description: "Quick pass that focuses on each product's hero image.",
      benefit: "Fast once-over to keep PDP hero shots compliant.",
      countLabel: formatImageCount(totalMainImageTargets),
      targetCount: totalMainImageTargets,
      icon: "product",
      bestFor: "Quick PDP check",
      accentTone: "success",
    },
  ];
  useEffect(() => {
    setPageByTab((current) => {
      const adjusted = Math.min(current[resourceTab], totalPages);
      return current[resourceTab] === adjusted
        ? current
        : { ...current, [resourceTab]: adjusted };
    });
  }, [resourceTab, totalPages]);

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
    if (!totalSelected) {
      shopify.toast.show?.("Select at least one product.");
      return;
    }
    if (maxProductsPerJob !== Infinity && totalSelected > maxProductsPerJob) {
      notifyPlanLimit();
      return;
    }

    const languageValue = language;
    const toneConfig = creativeTones.find((option) => option.value === tone) || creativeTones[0];
    const toneSnippet =
      toneConfig?.snippet || "Use a clear, neutral ecommerce tone. Concise, professional, no jokes, no hype.";
    const blockedTerms = [];

    const selectedFields = selectedTypes
      .map((typeId) => ALT_TEXT_FIELD_NAME_BY_TYPE[typeId])
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

    const payloadImageCounts = {};
    let totalImageTargetsForPayload = 0;
    productsToGenerate.forEach((product) => {
      const derivedCount = imageCountsByProduct[product.id];
      const count =
        typeof derivedCount === "number"
          ? clampImageTargetCount(derivedCount)
          : clampImageTargetCount(getImageTargetCount(product.id));
      payloadImageCounts[product.id] = count;
      totalImageTargetsForPayload += count;
    });

    if (totalImageTargetsForPayload === 0) {
      shopify.toast.show?.("Selected products do not have images to update.");
      return;
    }

    const customInstructionPayload = Object.entries(customInstructions).reduce((acc, [typeId, state]) => {
      if (!state?.enabled || !state?.text) {
        return acc;
      }
      const field = ALT_TEXT_FIELD_NAME_BY_TYPE[typeId];
      if (field) {
        acc[field] = state.text.trim();
      }
      return acc;
    }, {});

    const templatePayload = Object.entries(selectedTemplatesByType).reduce((acc, [typeId, template]) => {
      if (!template) {
        return acc;
      }
      const field = ALT_TEXT_FIELD_NAME_BY_TYPE[typeId];
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
      task: "alt_text",
      tone_snippet: toneSnippet,
      blocked_terms: blockedTerms,
      custom_instructions: customInstructionPayload,
      templates: templatePayload,
      image_scope: imageScope,
      image_counts: payloadImageCounts,
      total_image_targets: totalImageTargetsForPayload,
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
      <s-page heading="Alt text generator">
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
                </s-button-group>


                {/* Table */}
                <s-section padding="none" accessibilityLabel="Product selection table">
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
                        <s-stack
                          direction="inline"
                          gap="tight"
                          align="center"
                          style={{ justifyContent: "flex-end", flexWrap: "wrap" }}
                        >
                          <s-button
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
                        </s-stack>
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
                        <s-table-header format="numeric">Images</s-table-header>
                        <s-table-header>Quality</s-table-header>
                      </s-table-header-row>

                      <s-table-body>
                        {pagedRows.length === 0 ? (
                          <s-table-row>
                            <s-table-cell colSpan="4">
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
                              resourceTab === "products"
                                ? row.rawProduct?.body_html || row.short || ""
                                : row.short || row.description || "";
                            const descriptionText =
                              truncateText(stripHtmlTags(descriptionSource)) ||
                              "No description available";
                            const isSelected = selection.includes(row.id);
                            const totalImages = Number(row.imageCount) || 0;

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
                                      target.closest("a") ||
                                      target.closest("s-link") ||
                                      target.closest("s-checkbox"))
                                  ) {
                                    return;
                                  }
                                  if (!isSelected && productSelectionLimitReached) {
                                    notifyPlanLimit();
                                    return;
                                  }
                                  toggleResource(row.id);
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
                                      onChange={() => {
                                        if (!isSelected && productSelectionLimitReached) {
                                          notifyPlanLimit();
                                          return;
                                        }
                                        toggleResource(row.id);
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
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "0.35rem",
                                          flexWrap: "wrap",
                                        }}
                                      >
                                        <s-text type="strong" truncate>
                                          {row.title}
                                        </s-text>
                                      </div>
                                      <s-text appearance="subdued" size="small">
                                        {descriptionText}
                                      </s-text>
                                    </div>
                                  </div>
                                </s-table-cell>
                                <s-table-cell format="numeric">
                                  <s-text type="strong">{totalImages}</s-text>
                                  <s-text appearance="subdued" size="small">
                                    {totalImages === 1 ? "image" : "images"}
                                  </s-text>
                                </s-table-cell>
                                <s-table-cell>
                                  {row.rating != null ? (
                                    <s-badge tone={getRatingTone(row.rating)} appearance="subdued">
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
              <s-stack direction="block" gap="base">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: "1.25rem",
                  }}
                >
                  {coverageOptions.map((option) => {
                    const isSelected = imageScope === option.id;
                    const accent = "linear-gradient(135deg, rgba(12,68,204,0.08), rgba(12,68,204,0.02))";
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setImageScope(option.id)}
                        style={{
                          border: isSelected ? "1px solid transparent" : "1px solid var(--p-color-border)",
                          borderRadius: "18px",
                          padding: "20px 22px",
                          textAlign: "left",
                          background: isSelected ? accent : "white",
                          cursor: "pointer",
                          boxShadow: isSelected
                            ? "0 18px 32px rgba(24, 64, 123, 0.18)"
                            : "0 4px 16px rgba(0,0,0,0.05)",
                          transform: isSelected ? "translateY(-2px)" : "translateY(0)",
                          transition: "box-shadow 0.2s ease, transform 0.2s ease",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.6rem",
                          color: "inherit",
                          font: "inherit",
                          backgroundClip: "padding-box",
                          outline: "none",
                          width: "100%",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.75rem",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            <span
                              style={{
                                background: "rgba(255,255,255,0.7)",
                                borderRadius: "999px",
                                padding: "8px",
                                display: "inline-flex",
                                boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
                              }}
                            >
                              <s-icon tone="primary" type={option.icon || "images"} />
                            </span>
                            <s-text type="strong" size="large">
                              {option.title}
                            </s-text>
                          </div>
                          {isSelected && (
                            <s-badge tone="success" appearance="subdued">
                              Selected
                            </s-badge>
                          )}
                        </div>
                        <div>
                          <s-text appearance="subdued">{option.description}</s-text>
                          {option.benefit && (
                            <s-text appearance="subdued" size="small">
                              {option.benefit}
                            </s-text>
                          )}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <span
                            style={{
                              background: "rgba(255,255,255,0.7)",
                              color: "#0b4284",
                              borderRadius: "999px",
                              padding: "4px 11px",
                              fontWeight: 600,
                              fontSize: "12px",
                            }}
                          >
                            {option.countLabel}
                          </span>
                        </div>
                        <s-badge tone={option.id === "all" ? "info" : "success"} appearance="subdued">
                          Best for: {option.bestFor}
                        </s-badge>
                      </button>
                    );
                  })}
                </div>

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
              {totalSelectedTargets > 0 && totalImageTargets > 0 && (
                <s-text appearance="subdued" size="small">
                  {totalSelectedTargets} {totalSelectedTargets === 1 ? "product" : "products"}
                  {" \u00B7 "}
                  {totalImageTargets} {totalImageTargets === 1 ? "image" : "images"}
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
                totalImageTargets === 0 ||
                isGeneratingContent ||
                hasActiveJob ||
                insufficientCredits
              }
              {...(isGeneratingContent ? { loading: true } : {})}
            >
              {isGeneratingContent
                ? "Generating..."
                : totalSelectedTargets > 0
                  ? `Generate alt texts for ${totalSelectedTargets} ${
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
