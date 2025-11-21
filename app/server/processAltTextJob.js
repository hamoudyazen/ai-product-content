import prisma from "../db.server";
import {
  buildAltTextMessages,
  callOpenAiJson,
  isOpenAiConfigured,
} from "../utils/openai.server";
import { apiVersion, sessionStorage } from "../shopify.server";
import { getAdminClientForShop } from "./shopifyAdmin.server";
import { sanitizeIdList } from "../utils/creditMath";

const PRODUCT_IMAGE_QUERY = `#graphql
  query AltTextProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      featuredImage {
        id
        url
      }
      images(first: 50) {
        edges {
          node {
            id
            url
            originalSrc
            altText
          }
        }
      }
    }
  }
`;

export const processAltTextJob = async (job, overrideConfig) => {
  if (!isOpenAiConfigured()) {
    throw new Error("OpenAI API key is not configured.");
  }

  const config = overrideConfig || job.config || {};
  const productIds = sanitizeIdList(config.productIds);
  const settings = config.settings || {};
  const imageScope = settings.image_scope === "all" ? "all" : "main";
  const expectedImageCounts = settings.image_counts || {};

  if (!productIds.length) {
    throw new Error("Job config missing productIds for alt text generation.");
  }

  const admin = await getAdminClientForShop({
    shopDomain: job.shopDomain,
    sessionId: config.sessionId,
  });
  const session =
    config.sessionId && typeof sessionStorage?.loadSession === "function"
      ? await sessionStorage.loadSession(config.sessionId)
      : null;
  const restAccessToken = session?.accessToken;
  if (!restAccessToken) {
    throw new Error("Missing Shopify access token for alt text update.");
  }

  const totalItemsTarget = Number(job.totalItems) || 0;
  let processed = Number(job.processedItems) || 0;

  const getExpectedCountForProduct = (productId) => {
    const raw = Number(expectedImageCounts?.[productId]);
    if (Number.isFinite(raw)) {
      if (raw > 0) {
        return Math.floor(raw);
      }
      return 0;
    }
    return imageScope === "all" ? 1 : 1;
  };

  const incrementProgress = async (count = 1) => {
    if (count <= 0) {
      return;
    }
    if (totalItemsTarget > 0) {
      processed = Math.min(processed + count, totalItemsTarget);
    } else {
      processed += count;
    }
    await updateProgress(job.id, processed);
  };

  for (const productId of productIds) {
    const product = await fetchProductWithImages(admin, productId);
    if (!product) {
      await incrementProgress(getExpectedCountForProduct(productId));
      continue;
    }

    const targetImages = selectImages(product, imageScope);
    if (!targetImages.length) {
      await incrementProgress(getExpectedCountForProduct(productId));
      continue;
    }

    for (const image of targetImages) {
      try {
        const aiResult = await callOpenAiJson(
          buildAltTextMessages({
            productTitle: product.title,
            productHandle: product.handle,
            existingAltText: image.altText,
            imageUrl: image.url,
          }),
        );
        const rawAltText = aiResult?.alt_text ?? aiResult?.altText ?? null;
        const altText = normalizeAltText(rawAltText);
        if (!altText) {
          console.warn(`[AltTextJob] No alt text returned for image ${image.id}`);
          continue;
        }
        await updateImageAltViaRest({
          shopDomain: job.shopDomain,
          accessToken: restAccessToken,
          productId: product.id,
          imageId: image.id,
          altText,
        });
      } catch (error) {
        console.error(`[AltTextJob] Failed to update image ${image.id}`, error);
      } finally {
        await incrementProgress(1);
      }
    }
  }
};

const updateProgress = async (jobId, processed) => {
  await prisma.bulkJob.update({
    where: { id: jobId },
    data: { processedItems: processed },
  });
};

const fetchProductWithImages = async (admin, productId) => {
  const response = await admin.graphql(PRODUCT_IMAGE_QUERY, {
    variables: { id: productId },
  });
  const json = await response.json();
  const node = json?.data?.product;
  if (!node) {
    return null;
  }

  const images =
    node.images?.edges
      ?.map(({ node: image }) => ({
        id: image?.id,
        altText: image?.altText || "",
        url: image?.url || image?.originalSrc || "",
      }))
      .filter((image) => image.id && image.url) || [];

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    featuredImageId: node.featuredImage?.id || null,
    images,
  };
};

const selectImages = (product, scope) => {
  const images = Array.isArray(product.images) ? product.images : [];
  if (!images.length) {
    return [];
  }
  if (scope === "all") {
    return images;
  }
  if (product.featuredImageId) {
    const featured = images.find((image) => image.id === product.featuredImageId);
    if (featured) {
      return [featured];
    }
  }
  return [images[0]];
};

const normalizeAltText = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }
  const words = compact.split(" ").slice(0, 15);
  const sentence = words.join(" ").trim();
  if (!sentence) {
    return null;
  }
  return sentence;
};

const extractNumericId = (gid = "") => {
  if (typeof gid !== "string") return null;
  const parts = gid.split("/");
  return parts[parts.length - 1] || null;
};

const updateImageAltViaRest = async ({ shopDomain, accessToken, productId, imageId, altText }) => {
  const productNumericId = extractNumericId(productId);
  const imageNumericId = extractNumericId(imageId);
  if (!productNumericId || !imageNumericId) {
    throw new Error(`Invalid product or image id (${productId}, ${imageId})`);
  }

  const url = `https://${shopDomain}/admin/api/${apiVersion}/products/${productNumericId}/images/${imageNumericId}.json`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      image: {
        id: Number(imageNumericId),
        alt: altText,
      },
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Failed to update image alt text via REST (${response.status} ${response.statusText}): ${bodyText}`,
    );
  }
};
