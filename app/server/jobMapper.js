const FIELD_TO_TYPE_ID = {
  title: "productTitle",
  description: "description",
  meta_title: "metaTitle",
  meta_description: "metaDescription",
  alt_text: "altText",
};

const COLLECTION_FIELD_TO_TYPE_ID = {
  title: "collectionTitle",
  description: "collectionDescription",
  meta_title: "collectionMetaTitle",
  meta_description: "collectionMetaDescription",
};

export const mapBulkJob = (job) => {
  if (!job) return null;
  const config = job.config || {};
  const settings = config.settings || {};
  const fieldsArray = Array.isArray(settings.fields) ? settings.fields : [];

  const fieldMap = job.type === "collections" ? COLLECTION_FIELD_TO_TYPE_ID : FIELD_TO_TYPE_ID;

  const types = fieldsArray
    .map((field) => fieldMap[field] || field)
    .filter(Boolean);

  const productsCount = Array.isArray(config.productIds) ? config.productIds.length : 0;
  const collectionsCount = Array.isArray(config.collectionIds) ? config.collectionIds.length : 0;

  return {
    id: job.id,
    status: job.status,
    type: job.type,
    workItemCount: job.totalItems ?? 0,
    estimatedCredits: job.totalItems ?? 0,
    completedItems: job.processedItems ?? 0,
    errorMessage: job.errorMessage,
    selection: {
      products: productsCount,
      collections: collectionsCount,
    },
    types,
    createdAt: job.createdAt?.toISOString?.() || job.createdAt,
    createdAtMs: job.createdAt ? new Date(job.createdAt).getTime() : undefined,
  };
};

export const mapBulkJobs = (jobs = []) => jobs.map((job) => mapBulkJob(job)).filter(Boolean);
