import { redirect } from "react-router";
import prisma from "../db.server";
import { authenticate, sessionStorage } from "../shopify.server";
import { reserveShopCredits } from "../server/shopCredit.server";
import { DEFAULT_PLAN, getPlanConfig } from "../utils/planConfig";
import {
  ALT_TEXT_FIELD_ALLOWLIST,
  COLLECTION_FIELD_ALLOWLIST,
  PRODUCT_FIELD_ALLOWLIST,
  calculateAltTextItems,
  calculateWorkItems,
  clampImageTargetCount,
  isValidCollectionGid,
  isValidProductGid,
  sanitizeIdList,
  uniqueFieldList,
} from "../utils/creditMath";

const respondJson = (body, status = 400) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  if (!shopDomain) {
    throw respondJson({ error: "Missing shop context for job creation." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw respondJson({ error: "Invalid JSON body." });
  }

  const productIds = sanitizeIdList(body?.productIds).filter((id) => {
    if (!isValidProductGid(id)) {
      throw respondJson({ error: "Product selection contains an invalid id." });
    }
    return true;
  });
  const collectionIds = sanitizeIdList(body?.collectionIds).filter((id) => {
    if (!isValidCollectionGid(id)) {
      throw respondJson({ error: "Collection selection contains an invalid id." });
    }
    return true;
  });
  const settings = body?.settings && typeof body.settings === "object" ? body.settings : null;

  if (productIds.length && collectionIds.length) {
    throw respondJson({ error: "Select products or collections, not both at once." });
  }

  if (
    !settings ||
    typeof settings !== "object" ||
    !Array.isArray(settings.fields) ||
    settings.fields.length === 0
  ) {
    throw respondJson({ error: "Settings with at least one selected field are required." });
  }

  if (!productIds.length && !collectionIds.length) {
    throw respondJson({ error: "Select at least one product or collection." });
  }

  const offlineSessionId = `offline_${shopDomain}`;
  let offlineSession = await sessionStorage.loadSession(offlineSessionId);
  if (!offlineSession) {
    offlineSession = session.toOfflineSession();
    await sessionStorage.storeSession(offlineSession);
  }
  if (!offlineSession) {
    throw respondJson({ error: "No offline session available for this shop." }, 503);
  }

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { currentPlan: true },
  });
  const currentPlanId = shopRecord?.currentPlan || DEFAULT_PLAN;
  const planConfig = getPlanConfig(currentPlanId);

  const jobType = collectionIds.length ? "collections" : "products";
  const isAltTextTask = settings.task === "alt_text";
  if (isAltTextTask && jobType !== "products") {
    throw respondJson({ error: "Alt text generation is only supported for products." });
  }

  const requestedFields = uniqueFieldList(settings.fields);
  if (!requestedFields.length) {
    throw respondJson({ error: "Provide at least one valid field." });
  }

  const allowedFields = isAltTextTask
    ? ALT_TEXT_FIELD_ALLOWLIST
    : jobType === "collections"
      ? COLLECTION_FIELD_ALLOWLIST
      : PRODUCT_FIELD_ALLOWLIST;
  const invalidFields = requestedFields.filter((field) => !allowedFields.includes(field));
  if (invalidFields.length) {
    throw respondJson({
      error: `Unsupported field(s) selected: ${invalidFields.join(", ")}`,
    });
  }

  const targetCount = jobType === "collections" ? collectionIds.length : productIds.length;

  if (jobType === "products" && productIds.length > planConfig.maxProductsPerJob) {
    throw respondJson(
      {
        error: `Your ${planConfig.title} plan supports up to ${planConfig.maxProductsPerJob} products per bulk job. Reduce your selection or upgrade your plan.`,
      },
      422,
    );
  }
  let totalItems = 0;

  let sanitizedSettings = {
    ...settings,
    fields: requestedFields,
  };

  if (isAltTextTask) {
    const imageScope = settings.image_scope === "all" ? "all" : "main";
    const rawImageCounts =
      settings.image_counts && typeof settings.image_counts === "object"
        ? settings.image_counts
        : {};
    const sanitizedImageCounts = {};
    productIds.forEach((productId) => {
      if (Object.prototype.hasOwnProperty.call(rawImageCounts, productId)) {
        sanitizedImageCounts[productId] = clampImageTargetCount(
          Number(rawImageCounts[productId]),
        );
      }
    });
    sanitizedSettings = {
      ...sanitizedSettings,
      task: "alt_text",
      image_scope: imageScope,
      image_counts: sanitizedImageCounts,
    };
    totalItems = calculateAltTextItems(productIds, sanitizedSettings);
    sanitizedSettings.total_image_targets = totalItems;
  } else {
    totalItems = calculateWorkItems(targetCount, requestedFields);
  }

  if (totalItems <= 0) {
    throw respondJson({ error: "No eligible items to generate." });
  }
  try {
    await reserveShopCredits(shopDomain, totalItems);
  } catch (error) {
    throw respondJson({ error: error.message || "Unable to reserve credits." }, 402);
  }

  const job = await prisma.bulkJob.create({
    data: {
      shopDomain,
      type: collectionIds.length ? "collections" : "products",
      status: "queued",
      config: {
        productIds,
        collectionIds,
        settings: sanitizedSettings,
        sessionId: offlineSession.id,
        creditCost: totalItems,
      },
      totalItems,
    },
  });

  return new Response(JSON.stringify({ jobId: job.id }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};

export const loader = () => {
  throw redirect("/app");
};
