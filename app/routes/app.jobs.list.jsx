import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { mapBulkJobs } from "../server/jobMapper";
import { getOrCreateShopCredit } from "../server/shopCredit.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const jobs = await prisma.bulkJob.findMany({
    where: { shopDomain },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  const creditRecord = await getOrCreateShopCredit(shopDomain);

  return new Response(
    JSON.stringify({
      jobs: mapBulkJobs(jobs),
      credits: creditRecord?.creditsBalance ?? 0,
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
};

export const action = () => {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
};
