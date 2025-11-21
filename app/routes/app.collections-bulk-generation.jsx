import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate, apiVersion } from "../shopify.server";
import { getOrCreateShopCredit } from "../server/shopCredit.server";
import { rateProductContent } from "../utils/productQuality";
import { PLAN_CONFIG, DEFAULT_PLAN } from "../utils/planConfig";
import { calculateWorkItems } from "../utils/creditMath";

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
  {
    id: "collectionTitle",
    label: "Collection title",
    description: "50–65 characters. Highlights the core product group and main keyword.",
  },
  {
    id: "collectionDescription",
    label: "Collection description",
    description: "120–220 words with an intro and bullet points. Summarizes what unifies the assortment.",
  },
  {
    id: "collectionMetaTitle",
    label: "Collection meta title",
    description: "Max 60 characters. Search engine title shown in browser tabs and search results.",
  },
  {
    id: "collectionMetaDescription",
    label: "Collection meta description",
    description: "120–155 characters. Used as the SEO snippet shown under the link in search results.",
  },
];

const COLLECTION_FIELD_NAME_BY_TYPE = {
  collectionTitle: "title",
  collectionDescription: "description",
  collectionMetaTitle: "meta_title",
  collectionMetaDescription: "meta_description",
};

const templateCategories = [
  {
    id: "collection-essentials",
    title: "Collection Essentials",
    templates: [
      {
        name: "Merch Table Overview",
        description: "Neutral summary for everyday assortments.",
        prompt:
          "Explain what binds the collection together (materials, use case, audience). Keep the tone crisp and practical, highlighting 2–3 hero product groupings shoppers will find.",
        sample: "Reads like a clear merch note that orients shoppers immediately.",
        tags: ["overview", "neutral", "core"],
      },
      {
        name: "Quick Scan Grid",
        description: "Ultra scannable recap of key highlights.",
        prompt:
          "Write tight sentences and optional bullet-style phrases. Surface the dominant palette, silhouettes, and why the assortment is easy to shop. Avoid marketing filler.",
        sample: "Sounds like a cheat sheet for browsing the rack fast.",
        tags: ["minimal", "scan", "bulleted"],
      },
      {
        name: "Benefit Stack",
        description: "Lead with shopper gains before details.",
        prompt:
          "State the shopper problem this collection solves, then stack the benefits (comfort, versatility, styling ease). Tie each benefit back to shared product traits.",
        sample: "Shows the payoff before unpacking the assortment specifics.",
        tags: ["benefit-led", "value", "clarity"],
      },
      {
        name: "Fabric & Fit Rollup",
        description: "Factual tone focused on materials.",
        prompt:
          "Summarize the signature fabrics, construction details, and fit profiles spanning the collection. Keep it technical but readable, noting why those choices matter.",
        sample: "Feels like a concise spec sheet for the entire edit.",
        tags: ["fabric", "fit", "technical"],
      },
    ],
  },
  {
    id: "story-mood",
    title: "Story & Mood",
    templates: [
      {
        name: "Mood Board Moment",
        description: "Sets the vibe of the curation.",
        prompt:
          "Describe the atmosphere or scene this collection evokes (studio, coastal walk, night out). Keep it to 2–3 sentences and transition back to tangible assortment details.",
        sample: "Opens with a visual snapshot before guiding the browse.",
        tags: ["story", "mood", "scene"],
      },
      {
        name: "Lifestyle Loop",
        description: "Connects outfits to daily rituals.",
        prompt:
          "Anchor the collection to repeatable routines—commutes, weekend markets, training blocks. Mention how multiple pieces mix to support that flow without inventing items.",
        sample: "Feels like a stylist narrating a day in the collection.",
        tags: ["lifestyle", "routine", "styling"],
      },
      {
        name: "Maker Spotlight",
        description: "Highlights the design studio or brand lens.",
        prompt:
          "Reference the brand’s point of view, studio inspiration, or sourcing journey that shaped the assortment. Keep it grounded and avoid fictional backstories.",
        sample: "Shares why the brand curated these pieces now.",
        tags: ["brand", "studio", "design"],
      },
      {
        name: "Gift Concierge",
        description: "Frames the edit as a gifting shortcut.",
        prompt:
          "Explain who the collection suits (hosts, coworkers, new parents) and why the assortment makes gifting easy. Stay warm but concise; avoid cliché holiday lines.",
        sample: "Guides shoppers on picking from the edit for each name on the list.",
        tags: ["gift", "warm", "guide"],
      },
    ],
  },
  {
    id: "seasonal-campaign",
    title: "Seasonal & Campaign",
    templates: [
      {
        name: "Drop Announcement",
        description: "Signals a new capsule landing.",
        prompt:
          "Introduce what’s new, why it matters this season, and nod to any limited runs. Keep urgency soft—no countdowns—while spotlighting fresh textures or palettes.",
        sample: "Reads like a calm campaign intro for the launch.",
        tags: ["drop", "launch", "capsule"],
      },
      {
        name: "Seasonal Essentials",
        description: "Translates the assortment for current weather.",
        prompt:
          "Tie the collection to the climate (layering for cold snaps, breathable fabrics for heat). Mention practical styling tips like pairing lightweight knits with structured bottoms.",
        sample: "Explains how the edit solves for the forecast.",
        tags: ["seasonal", "weather", "timely"],
      },
      {
        name: "Capsule Wardrobe",
        description: "Positions the edit as mix-and-match kit.",
        prompt:
          "Describe how shoppers can build multiple looks from these SKUs. Reference silhouettes that pair well and call out anchor pieces, without inventing product names.",
        sample: "Feels like a stylist’s capsule blueprint.",
        tags: ["capsule", "wardrobe", "mix-match"],
      },
      {
        name: "Limited Release Tease",
        description: "Adds light exclusivity.",
        prompt:
          "Mention small-batch runs, numbered pieces, or once-a-season palettes if provided. Use calm language (\"limited batch\", \"small release\") instead of hype-heavy words.",
        sample: "Creates gentle urgency without sounding like a flash sale.",
        tags: ["limited", "drop", "exclusive"],
      },
    ],
  },
  {
    id: "values-utility",
    title: "Values & Utility",
    templates: [
      {
        name: "Performance Pack",
        description: "Focuses on function-first assortments.",
        prompt:
          "Detail the technical stories behind the collection (sweat-wicking sets, reinforced seams, grip soles). Connect each feature back to the type of activity it supports.",
        sample: "Sounds like a coach explaining why each piece earns its spot.",
        tags: ["performance", "training", "utility"],
      },
      {
        name: "Sustainability Edit",
        description: "Spotlights eco credentials.",
        prompt:
          "Surface verified materials, certifications, or manufacturing choices that reduce impact. Explain benefits succinctly—longer wear, fewer washes, lower waste.",
        sample: "Gives shoppers the sustainability rationale at a glance.",
        tags: ["sustainable", "eco", "values"],
      },
      {
        name: "Care & Styling Tips",
        description: "Helps shoppers wear the pieces longer.",
        prompt:
          "Include one care reminder (gentle wash, air dry) and one styling cue (layer with denim, soften with knits). Emphasize longevity and versatility of the full assortment.",
        sample: "Feels like a smart associate sharing pro tips.",
        tags: ["care", "styling", "longevity"],
      },
      {
        name: "Mix & Match Guide",
        description: "Encourages building outfits from the edit.",
        prompt:
          "Outline 2–3 outfit formulas using categories (tailored pants + ribbed tanks, utility jackets + cargos). Mention color stories so shoppers see how pieces connect.",
        sample: "Reads like a short how-to for building looks from the rack.",
        tags: ["outfits", "guide", "pairing"],
      },
    ],
  },
];


const PAGE_SIZE = 10;
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const hostParam = url.searchParams.get("host") || null;

  try {
    const fetchCollections = async (path, key) => {
      const response = await fetch(
        `https://${shopDomain}/admin/api/${apiVersion}/${path}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken,
          },
        },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to fetch ${key}: ${errorBody}`);
      }
      const payload = await response.json();
      return payload?.[key] ?? [];
    };

    const [customCollections, smartCollections] = await Promise.all([
      fetchCollections("custom_collections.json?limit=250&published_status=any", "custom_collections"),
      fetchCollections("smart_collections.json?limit=250&published_status=any", "smart_collections"),
    ]);

    const combined = [...customCollections, ...smartCollections];
    const seen = new Set();
    const collections = combined
      .map((collection) => {
        if (!collection?.id) {
          return null;
        }
        const gid =
          typeof collection.admin_graphql_api_id === "string" &&
          collection.admin_graphql_api_id.trim()
            ? collection.admin_graphql_api_id.trim()
            : `gid://shopify/Collection/${collection.id}`;
        if (seen.has(gid)) {
          return null;
        }
        seen.add(gid);
        const productsCount = Number(collection?.products_count ?? 0);
        const descriptionHtml = collection.body_html || "";
        const rating = rateProductContent({
          title: collection.title || "",
          productType: "Collection",
          vendor: "",
          descriptionHtml,
          seo: {
            title: collection.title || "",
            description: stripHtmlTags(descriptionHtml),
          },
        });
        return {
          id: gid,
          title: collection.title,
          status: collection?.published_at ? "ACTIVE" : "UNPUBLISHED",
          short:
            productsCount === 1
              ? "1 product"
              : `${productsCount.toLocaleString()} products`,
          description: descriptionHtml,
          image: collection.image?.src || "",
          altText: collection.image?.alt || collection.title,
          productCount: productsCount,
          rating: Number.isFinite(rating) ? parseFloat(rating.toFixed(1)) : null,
        };
      })
      .filter(Boolean);

    const activeJob = await prisma.bulkJob.findFirst({
      where: { shopDomain, status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "desc" },
    });
    const creditRecord = await getOrCreateShopCredit(shopDomain);
    const planId = creditRecord?.currentPlan || DEFAULT_PLAN;
    return {
      collections,
      hasActiveJob: Boolean(activeJob),
      activeJobId: activeJob?.id ?? null,
      hostParam,
      creditBalance: creditRecord?.creditsBalance ?? 0,
      planId,
    };
  } catch (error) {
    console.error("Failed to load collections for bulk generation", error);
    return {
      collections: [],
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
    collections,
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
  const collectionRows = useMemo(
    () => (Array.isArray(collections) ? collections : []),
    [collections],
  );
  const generationTypeLookup = useMemo(() => {
    return generationTypes.reduce((acc, type) => {
      acc[type.id] = type;
      return acc;
    }, {});
  }, []);
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [planId, setPlanId] = useState(initialPlanId);
  useEffect(() => {
    setPlanId(initialPlanId);
  }, [initialPlanId]);
  const planConfig = PLAN_CONFIG[planId] || PLAN_CONFIG[DEFAULT_PLAN];
  const maxCollectionsPerJob = planConfig?.maxProductsPerJob ?? Infinity;
  const [page, setPage] = useState(1);
  const [selectedTypes, setSelectedTypes] = useState(generationTypes.map((type) => type.id));
  const selectedFields = useMemo(
    () =>
      selectedTypes
        .map((typeId) => COLLECTION_FIELD_NAME_BY_TYPE[typeId] || null)
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
  const [collectionSearchQuery, setCollectionSearchQuery] = useState("");
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [hasActiveJob, setHasActiveJob] = useState(initialHasActiveJob);
  const [activeJobId, setActiveJobId] = useState(initialActiveJobId);

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

  const filteredCollectionRows = useMemo(() => {
    const tokens = collectionSearchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      return collectionRows;
    }
    return collectionRows.filter((row) => {
      const descriptionSource = row.description || row.short || "";
      const searchableFields = [
        row.title,
        row.short,
        row.status,
        row.handle,
        Array.isArray(row.tags) ? row.tags.join(" ") : "",
        stripHtmlTags(descriptionSource),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => searchableFields.includes(token));
    });
  }, [collectionRows, collectionSearchQuery]);
  const currentRows = filteredCollectionRows;
  const hasCollections = collectionRows.length > 0;
  const selection = selectedCollections;
  const totalPages = Math.max(1, Math.ceil(currentRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = currentRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  useEffect(() => {
    setSelectedCollections((current) => {
      const validIds = collectionRows.map((collection) => collection.id);
      const filtered = current.filter((id) => validIds.includes(id));
      if (!filtered.length && validIds.length) {
        const defaults =
          maxCollectionsPerJob === Infinity
            ? validIds
            : validIds.slice(0, maxCollectionsPerJob);
        return defaults;
      }
      if (maxCollectionsPerJob !== Infinity && filtered.length > maxCollectionsPerJob) {
        return filtered.slice(0, maxCollectionsPerJob);
      }
      return filtered;
    });
  }, [collectionRows, maxCollectionsPerJob]);

  useEffect(() => {
    setPage(1);
  }, [collectionSearchQuery]);

  const toggleType = (typeId) => {
    setSelectedTypes((current) =>
      current.includes(typeId)
        ? current.filter((id) => id !== typeId)
        : [...current, typeId],
    );
  };

  const selectedCollectionCount = selectedCollections.length;
  const collectionLimitReached =
    maxCollectionsPerJob !== Infinity && selectedCollectionCount >= maxCollectionsPerJob;
  const collectionLabel = selectedCollectionCount === 1 ? "collection" : "collections";
  const totalWorkItems = calculateWorkItems(selectedCollectionCount, selectedFields);
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
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const notifyPlanLimit = () => {
    if (maxCollectionsPerJob === Infinity) {
      return;
    }
    shopify.toast.show?.(
      `Your ${planConfig.title} plan supports up to ${maxCollectionsPerJob.toLocaleString()} items per bulk job.`,
    );
  };

  const toggleResource = (id) => {
    setSelectedCollections((current) => {
      if (current.includes(id)) {
        return current.filter((value) => value !== id);
      }
      if (maxCollectionsPerJob !== Infinity && current.length >= maxCollectionsPerJob) {
        notifyPlanLimit();
        return current;
      }
      return [...current, id];
    });
  };

  const toggleAll = () => {
    const rowIds = currentRows.map((row) => row.id);
    const isAllSelected = rowIds.every((rowId) => selection.includes(rowId));
    if (isAllSelected) {
      setSelectedCollections((current) => current.filter((id) => !rowIds.includes(id)));
      return;
    }
    setSelectedCollections((current) => {
      const merged = Array.from(new Set([...current, ...rowIds]));
      if (maxCollectionsPerJob !== Infinity && merged.length > maxCollectionsPerJob) {
        notifyPlanLimit();
        return merged.slice(0, maxCollectionsPerJob);
      }
      return merged;
    });
  };

  const clearCollectionSelection = () => {
    setSelectedCollections([]);
  };

  const changePage = (direction) => {
    setPage((current) => {
      const nextPage = Math.min(totalPages, Math.max(1, current + direction));
      return nextPage;
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
    const totalSelected = selectedCollections.length;
    if (!totalSelected || selectedFields.length === 0) {
      shopify.toast.show?.("Select at least one collection and output type.");
      return;
    }
    if (maxCollectionsPerJob !== Infinity && totalSelected > maxCollectionsPerJob) {
      notifyPlanLimit();
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

    const customInstructionPayload = Object.entries(customInstructions).reduce((acc, [typeId, state]) => {
      if (!state?.enabled || !state?.text) {
        return acc;
      }
      const field = COLLECTION_FIELD_NAME_BY_TYPE[typeId];
      if (field) {
        acc[field] = state.text.trim();
      }
      return acc;
    }, {});

    const templatePayload = Object.entries(selectedTemplatesByType).reduce((acc, [typeId, template]) => {
      if (!template) {
        return acc;
      }
      const field = COLLECTION_FIELD_NAME_BY_TYPE[typeId];
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
        collectionIds: selectedCollections,
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
      <s-page heading="Collection bulk generation">
        <s-stack direction="block" gap="base">
          {hasActiveJob && (
            <s-banner tone="warning" heading="Generation in progress">
              Finish reviewing the current job in Order history before queueing another run.
            </s-banner>
          )}

          <s-section
            heading="Select collections"
            description={
              maxCollectionsPerJob === Infinity
                ? undefined
                : `Your plan allows up to ${maxCollectionsPerJob.toLocaleString()} collections per bulk job.`
            }
          >
            <s-stack direction="block" gap="base">

              {!hasCollections && (
                <s-banner tone="warning" heading="No collections found">
                  Create a manual or smart collection in Shopify, then refresh this page to start generating content.
                </s-banner>
              )}

              {/* Table */}
              <s-section padding="none" accessibilityLabel="Collection selection table">
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
                        name="collection-search"
                        label="Search collections"
                        labelAccessibilityVisibility="exclusive"
                        icon="search"
                        placeholder="Search titles or descriptions"
                        value={collectionSearchQuery}
                        onInput={(event) => setCollectionSearchQuery(event.target.value)}
                      ></s-text-field>
                      <s-button
                        icon="eraser"
                        type="button"
                        variant="primary"
                        size="slim"
                        onClick={clearCollectionSelection}
                        disabled={selection.length === 0}
                      >
                        {selection.length === 0
                          ? "0 selected"
                          : `${selection.length} selected · Clear`}
                      </s-button>
                        </s-grid>
                        {maxCollectionsPerJob !== Infinity && (
                          <s-text
                            tone={collectionLimitReached ? "critical" : "subdued"}
                            size="small"
                            style={{ padding: "0 1rem" }}
                          >
                            Plan limit: up to {maxCollectionsPerJob.toLocaleString()} collections per bulk job.
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
                          Collection
                        </span>
                      </s-table-header>
                      <s-table-header>Description</s-table-header>
                      <s-table-header>Quality rating</s-table-header>
                    </s-table-header-row>

                    <s-table-body>
                      {pagedRows.length === 0 ? (
                        <s-table-row>
                          <s-table-cell colSpan="3">
                            <s-stack
                              direction="block"
                              gap="tight"
                              align="center"
                              style={{ padding: "1rem 0" }}
                            >
                              <s-icon type="search" tone="subdued" />
                              <s-text appearance="subdued">
                                {collectionSearchQuery
                                  ? "No collections match your search."
                                  : "No collections available. Create one in Shopify and refresh this page."}
                              </s-text>
                            </s-stack>
                          </s-table-cell>
                        </s-table-row>
                      ) : (
                        pagedRows.map((row) => {
                          const descriptionSource = row.description || row.short || "";
                          const descriptionText =
                            truncateText(stripHtmlTags(descriptionSource)) ||
                            "No description available";
                          const isSelected = selection.includes(row.id);
                          const ratingValue = typeof row.rating === "number" ? row.rating : null;

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
                                toggleResource(row.id);
                              }}
                            >
                              <s-table-cell>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleResource(row.id)}
                                    aria-label={`Select ${row.title}`}
                                  />
                                  <s-text type="strong" truncate>
                                    {row.title}
                                  </s-text>
                                </div>
                              </s-table-cell>

                              <s-table-cell>
                                <s-text tone="subdued" truncate>
                                  {descriptionText}
                                </s-text>
                              </s-table-cell>

                              <s-table-cell>
                                {ratingValue !== null ? (
                                  <s-badge tone={getRatingTone(ratingValue)}>
                                    {`${ratingValue.toFixed(1)} / 10`}
                                  </s-badge>
                                ) : (
                                  <s-badge appearance="subdued">Not rated</s-badge>
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
                            onClick={() => setPage(pageNumber)}
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

            <s-stack direction="block" gap="base">
              {selectedFields.length === 0 && (
                <s-banner tone="warning" heading="Choose at least one content output">
                  Toggle the switches on the cards below to include the outputs you want generated.
                </s-banner>
              )}

              <s-stack direction="block" gap="base">
                {generationTypes.map((type) => {
                  const typeId = type.id;
                  const customState = customInstructions[typeId] || {};
                  const modalId = `custom-instructions-${typeId}`;
                  const switchId = `collection-generation-type-${typeId}`;
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
            {selectedCollectionCount > 0 && selectedFields.length > 0 && (
                          <s-text appearance="subdued" size="small">
                            {selectedCollectionCount} {collectionLabel}
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
                selectedCollectionCount === 0 ||
                selectedFields.length === 0 ||
                isGeneratingContent ||
                hasActiveJob ||
                insufficientCredits
              }
              {...(isGeneratingContent ? { loading: true } : {})}
            >
              {isGeneratingContent
                ? "Generating..."
                : selectedCollectionCount > 0
                  ? `Generate content for ${selectedCollectionCount} ${collectionLabel}`
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
