import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { mapBulkJob } from "../server/jobMapper";

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

export const loader = async ({ request, params }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const jobId = params.jobId;

    if (!jobId) {
      return jsonResponse({ error: "Job id is required." }, { status: 400 });
    }

    const job = await prisma.bulkJob.findUnique({ where: { id: jobId } });
    if (!job || job.shopDomain !== shopDomain) {
      return jsonResponse({ error: "Job not found." }, { status: 404 });
    }

    return jsonResponse({ job: mapBulkJob(job) });
  } catch (error) {
    console.error("Failed to load job status", error);
    return jsonResponse(
      { error: "Failed to load job.", details: error?.message },
      { status: 500 },
    );
  }
};

export const action = () =>
  jsonResponse({ error: "Method not allowed." }, { status: 405 });

export default function AppApiJob() {
  return null;
}
