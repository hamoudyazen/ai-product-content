import prisma from "../db.server";
import {
  buildGenerationMessages,
  callOpenAiJson,
  isOpenAiConfigured,
} from "../utils/openai.server";
import { getAdminClientForShop } from "./shopifyAdmin.server";
import { PRODUCT_FIELD_ALLOWLIST, sanitizeIdList, uniqueFieldList } from "../utils/creditMath";

const PRODUCT_QUERY = `#graphql
  query ProductForJob($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      productType
      vendor
      tags
      descriptionHtml
      status
      seo {
        title
        description
      }
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
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation ApplyGeneratedProductContent($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const processProductsJob = async (job, overrideConfig) => {
  if (!isOpenAiConfigured()) {
    throw new Error("OpenAI API key is not configured.");
  }

  if (!job?.shopDomain) {
    throw new Error("Job missing shop domain.");
  }

  const config = overrideConfig || job.config || {};
  const productIds = sanitizeIdList(config.productIds);
  const settings = typeof config.settings === "object" && config.settings ? config.settings : {};
  const fields = uniqueFieldList(settings.fields).filter((field) =>
    PRODUCT_FIELD_ALLOWLIST.includes(field),
  );
  const generationSettings = {
    ...settings,
    fields,
  };

  if (!productIds.length || !fields.length) {
    throw new Error("Job config missing productIds or fields.");
  }

  const admin = await getAdminClientForShop({
    shopDomain: job.shopDomain,
    sessionId: config.sessionId,
  });
  const totalItems = Number(job.totalItems) || 0;
  const progressIncrement = fields.length || 1;
  let processed = Number(job.processedItems) || 0;

  for (const productId of productIds) {
    try {
      const rawProduct = await fetchProduct(admin, productId);
      if (!rawProduct) {
        continue;
      }

      const aiResult = await callOpenAiJson(
        buildGenerationMessages({
          product: rawProduct,
          settings: generationSettings,
        }),
      );

      await applyGeneratedContent(admin, productId, aiResult, fields);
    } catch (error) {
      console.error(`[ProductsJob] Failed to process product ${productId}`, error);
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

const fetchProduct = async (admin, productId) => {
  try {
    const response = await admin.graphql(PRODUCT_QUERY, {
      variables: { id: productId },
    });
    const json = await response.json();
    if (json?.errors?.length) {
      console.error("[ProductsJob] Shopify returned errors", json.errors);
      return null;
    }
    const node = json?.data?.product;
    if (!node) {
      return null;
    }

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

    const metafields =
      node.metafields?.edges?.reduce((acc, { node: mf }) => {
        if (mf?.key) {
          const key =
            mf.namespace && mf.namespace !== "global"
              ? `${mf.namespace}.${mf.key}`
              : mf.key;
          acc[key] = mf.value;
        }
        return acc;
      }, {}) || {};

    return {
      id: node.id,
      title: node.title,
      status: node.status,
      handle: node.handle,
      vendor: node.vendor,
      product_type: node.productType,
      tags: node.tags || [],
      options,
      variants,
      collections,
      body_html: node.descriptionHtml || "",
      metafields,
      seo: {
        title: node.seo?.title || "",
        description: node.seo?.description || "",
      },
    };
  } catch (error) {
    console.error(`[ProductsJob] Failed to fetch product ${productId}`, error);
    return null;
  }
};

const applyGeneratedContent = async (admin, productId, aiResult, fields) => {
  const input = { id: productId };
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

  if (
    !input.title &&
    !input.descriptionHtml &&
    !input.seo
  ) {
    return;
  }

  const response = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
    variables: { input },
  });
  const json = await response.json();
  const userErrors = json?.data?.productUpdate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(userErrors.map((error) => error.message).join("; "));
  }
};
