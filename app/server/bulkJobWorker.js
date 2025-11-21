import prisma from "../db.server";
import { processProductsJob } from "./processProductsJob";
import { processCollectionsJob } from "./processCollectionsJob";
import { processAltTextJob } from "./processAltTextJob";
import { refundShopCredits } from "./shopCredit.server";

let workerStarted = false;

export const startBulkJobWorker = () => {
  if (workerStarted) return;
  workerStarted = true;

  setInterval(async () => {
    try {
      await runNextJob();
    } catch (error) {
      console.error("[BulkJobWorker] Failed to run job", error);
    }
  }, 5000);
};

const runNextJob = async () => {
  const job = await prisma.bulkJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return;
  }

  await prisma.bulkJob.update({
    where: { id: job.id },
    data: { status: "running" },
  });

  try {
    const config = job.config || {};
    const settings = config.settings || {};

    if (job.type === "products") {
      if (isAltTextTask(settings)) {
        await processAltTextJob(job, config);
      } else {
        await processProductsJob(job, config);
      }
    } else if (job.type === "collections") {
      await processCollectionsJob(job);
    } else {
      throw new Error(`Unsupported bulk job type: ${job.type}`);
    }

    await prisma.bulkJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        processedItems: job.totalItems,
      },
    });
  } catch (error) {
    console.error("[BulkJobWorker] job failed", error);
    const creditCost = Number(job?.config?.creditCost) || 0;
    if (creditCost > 0) {
      await refundShopCredits(job.shopDomain, creditCost);
    }
    await prisma.bulkJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: error?.message || "Unknown error",
      },
    });
  }
};

const isAltTextTask = (settings = {}) => {
  if (settings.task === "alt_text") {
    return true;
  }
  const fields = Array.isArray(settings.fields) ? settings.fields : [];
  return fields.includes("alt_text");
};
