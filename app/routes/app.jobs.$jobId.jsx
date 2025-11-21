import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { mapBulkJob } from "../server/jobMapper";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const jobId = params.jobId;
  if (!jobId) {
    throw new Response(JSON.stringify({ error: "Job id is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const job = await prisma.bulkJob.findUnique({ where: { id: jobId } });
  if (!job || job.shopDomain !== shopDomain) {
    throw new Response(JSON.stringify({ error: "Job not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ job: mapBulkJob(job) }), {
    headers: { "Content-Type": "application/json" },
  });
};

export default function JobDetail() {
  const data = useLoaderData();
  const job = data?.job;
  if (!job) {
    return <p>Job not found.</p>;
  }
  return (
    <div style={{ padding: "1rem" }}>
      <h1>Bulk job {job.id}</h1>
      <p>Status: {job.status}</p>
      <p>
        Progress: {job.completedItems}/{job.workItemCount}
      </p>
      {job.errorMessage && <p>Error: {job.errorMessage}</p>}
    </div>
  );
}
