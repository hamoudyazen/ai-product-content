import { authenticate } from "../shopify.server";
import {
  buildRewriteMessages,
  callOpenAiJson,
  isOpenAiConfigured,
} from "../utils/openai.server";

const allowedFields = ["title", "description", "metaTitle", "metaDescription"];

export const loader = () => {
  return Response.json({ error: "Method not allowed." }, { status: 405 });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { title, description, metaTitle, metaDescription } = payload || {};
  let { fieldsToImprove } = payload || {};

  if (!Array.isArray(fieldsToImprove) || fieldsToImprove.length === 0) {
    fieldsToImprove = allowedFields;
  } else {
    fieldsToImprove = fieldsToImprove.filter((field) => allowedFields.includes(field));
  }

  if (fieldsToImprove.length === 0) {
    return Response.json({ error: "fieldsToImprove must include a valid field name." }, { status: 400 });
  }

  const hasContent = fieldsToImprove.some((field) => {
    const value = { title, description, metaTitle, metaDescription }[field];
    return typeof value === "string" && value.trim().length > 0;
  });

  if (!hasContent) {
    return Response.json({ error: "Provide content for the fields you want to rewrite." }, { status: 400 });
  }

  if (!isOpenAiConfigured()) {
    return Response.json(
      {
        error:
          "OpenAI API key is not configured. Set OPENAI_API_KEY (replace with your value instead of 'put api here').",
      },
      { status: 500 },
    );
  }

  try {
    const result = await callOpenAiJson(
      buildRewriteMessages({ title, description, metaTitle, metaDescription }, fieldsToImprove),
    );
    return Response.json(result);
  } catch (error) {
    console.error("Failed to boost product content", error);
    return Response.json({ error: "Unable to rewrite product content." }, { status: 500 });
  }
};
