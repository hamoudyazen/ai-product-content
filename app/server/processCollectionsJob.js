import prisma from "../db.server";
import {
  buildCollectionGenerationMessages,
  callOpenAiJson,
  isOpenAiConfigured,
} from "../utils/openai.server";
import { getAdminClientForShop } from "./shopifyAdmin.server";
import { COLLECTION_FIELD_ALLOWLIST, sanitizeIdList, uniqueFieldList } from "../utils/creditMath";

const COLLECTION_QUERY = `#graphql
  query CollectionForJob($id: ID!) {
    collection(id: $id) {
      id
      title
      handle
      descriptionHtml
      seo {
        title
        description
      }
      image {
        url
        altText
      }
      products(first: 10) {
        edges {
          node {
            id
            title
            productType
            vendor
          }
        }
      }
      templateSuffix
    }
  }
`;

const COLLECTION_UPDATE_MUTATION = `#graphql
  mutation ApplyGeneratedCollectionContent($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const processCollectionsJob = async (job) => {
  if (!isOpenAiConfigured()) {
    throw new Error("OpenAI API key is not configured.");
  }

  if (!job?.shopDomain) {
    throw new Error("Job missing shop domain.");
  }

  const config = job.config || {};
  const collectionIds = sanitizeIdList(config.collectionIds);
  const settings = typeof config.settings === "object" && config.settings ? config.settings : {};
  const fields = uniqueFieldList(settings.fields).filter((field) =>
    COLLECTION_FIELD_ALLOWLIST.includes(field),
  );
  const generationSettings = {
    ...settings,
    fields,
  };

  if (!collectionIds.length || !fields.length) {
    throw new Error("Job config missing collectionIds or fields.");
  }

  const admin = await getAdminClientForShop({
    shopDomain: job.shopDomain,
    sessionId: config.sessionId,
  });
  const totalItems = Number(job.totalItems) || 0;
  const progressIncrement = fields.length || 1;
  let processed = Number(job.processedItems) || 0;

  for (const collectionId of collectionIds) {
    try {
      const rawCollection = await fetchCollection(admin, collectionId);
      if (!rawCollection) {
        continue;
      }

      const aiResult = await callOpenAiJson(
        buildCollectionGenerationMessages({
          collection: rawCollection,
          settings: generationSettings,
        }),
      );

      await applyGeneratedCollectionContent(admin, collectionId, aiResult, fields);
    } catch (error) {
      console.error(`[CollectionsJob] Failed to process collection ${collectionId}`, error);
    } finally {
      processed += progressIncrement;
      await updateProgress(job.id, processed, totalItems);
    }
  }
};

const updateProgress = async (jobId, processed, totalItems) => {
  const safeValue =
    typeof totalItems === "number" && totalItems > 0
      ? Math.min(processed, totalItems)
      : processed;
  await prisma.bulkJob.update({
    where: { id: jobId },
    data: { processedItems: safeValue },
  });
};

const fetchCollection = async (admin, collectionId) => {
  try {
    const response = await admin.graphql(COLLECTION_QUERY, {
      variables: { id: collectionId },
    });
    const json = await response.json();
    if (json?.errors?.length) {
      console.error("[CollectionsJob] Shopify returned errors", json.errors);
      return null;
    }
    const node = json?.data?.collection;
    if (!node) {
      return null;
    }

    const products =
      node.products?.edges?.map(({ node: product }) => ({
        id: product.id,
        title: product.title,
        product_type: product.productType,
        vendor: product.vendor,
      })) || [];

    const productsCount = products.length;

    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      description_html: node.descriptionHtml || "",
      seo: {
        title: node.seo?.title || "",
        description: node.seo?.description || "",
      },
      image: node.image,
      productsCount,
      templateSuffix: node.templateSuffix,
      products,
    };
  } catch (error) {
    console.error(`[CollectionsJob] Failed to fetch collection ${collectionId}`, error);
    return null;
  }
};

const applyGeneratedCollectionContent = async (admin, collectionId, aiResult, fields) => {
  const input = { id: collectionId };
  if (fields.includes("title") && aiResult?.title) {
    input.title = aiResult.title.trim();
  }
  if (fields.includes("description") && aiResult?.description_html) {
    input.descriptionHtml = aiResult.description_html.trim();
  }
  if (fields.includes("meta_title") || fields.includes("meta_description")) {
    input.seo = {};
    if (fields.includes("meta_title") && aiResult?.meta_title) {
      input.seo.title = aiResult.meta_title.trim();
    }
    if (fields.includes("meta_description") && aiResult?.meta_description) {
      input.seo.description = aiResult.meta_description.trim();
    }
    if (!Object.keys(input.seo).length) {
      delete input.seo;
    }
  }

  if (!input.title && !input.descriptionHtml && !input.seo) {
    return;
  }

  const response = await admin.graphql(COLLECTION_UPDATE_MUTATION, {
    variables: { input },
  });
  const json = await response.json();
  const userErrors = json?.data?.collectionUpdate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(userErrors.map((error) => error.message).join("; "));
  }
};
