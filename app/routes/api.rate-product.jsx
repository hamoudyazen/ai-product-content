import { authenticate } from "../shopify.server";
import {
  buildEvaluationMessages,
  callOpenAiJson,
  isOpenAiConfigured,
} from "../utils/openai.server";

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

  if (
    typeof title !== "string" &&
    typeof description !== "string" &&
    typeof metaTitle !== "string" &&
    typeof metaDescription !== "string"
  ) {
    return Response.json({ error: "Provide at least one field to evaluate." }, { status: 400 });
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
      buildEvaluationMessages({ title, description, metaTitle, metaDescription }),
    );
    return Response.json(result);
  } catch (error) {
    console.error("Failed to evaluate product content", error);
    return Response.json({ error: "Unable to rate product content." }, { status: 500 });
  }
};
