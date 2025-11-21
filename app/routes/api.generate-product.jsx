import { authenticate } from "../shopify.server";
import {
  buildGenerationMessages,
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

  const { product, settings } = payload || {};

  if (!product || !settings) {
    return Response.json({ error: "Product and settings are required." }, { status: 400 });
  }

  if (!Array.isArray(settings.fields) || settings.fields.length === 0) {
    return Response.json({ error: "Provide at least one field to generate." }, { status: 400 });
  }

  if (!isOpenAiConfigured()) {
    return Response.json(
      {
        error:
          "OpenAI API key is not configured. Set OPENAI_API_KEY (replace with your actual value instead of 'put api here').",
      },
      { status: 500 },
    );
  }

  try {
    const result = await callOpenAiJson(buildGenerationMessages({ product, settings }));
    return Response.json(result);
  } catch (error) {
    console.error("Failed to generate product content", error);
    return Response.json(
      { error: error?.message || "Unable to generate product content." },
      { status: 500 },
    );
  }
};
