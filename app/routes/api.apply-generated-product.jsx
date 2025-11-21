import { authenticate } from "../shopify.server";

const mutation = `#graphql
  mutation ApplyGeneratedProductContent($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        bodyHtml
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const loader = () => {
  return Response.json({ error: "Method not allowed." }, { status: 405 });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { productId, content } = payload || {};

  if (!productId || typeof productId !== "string") {
    return Response.json({ error: "productId is required." }, { status: 400 });
  }

  if (!content || typeof content !== "object") {
    return Response.json({ error: "content payload is required." }, { status: 400 });
  }

  const productInput = { id: productId };

  if (typeof content.title === "string" && content.title.trim()) {
    productInput.title = content.title.trim();
  }

  if (typeof content.description_html === "string" && content.description_html.trim()) {
    productInput.descriptionHtml = content.description_html.trim();
  }

  if (
    (typeof content.meta_title === "string" && content.meta_title.trim()) ||
    (typeof content.meta_description === "string" && content.meta_description.trim())
  ) {
    productInput.seo = {
      title: content.meta_title?.trim() || undefined,
      description: content.meta_description?.trim() || undefined,
    };
  }

  if (!productInput.title && !productInput.descriptionHtml && !productInput.seo) {
    return Response.json({ error: "No updates provided." }, { status: 400 });
  }

  try {
    const response = await admin.graphql(mutation, {
      variables: { input: productInput },
    });
    const json = await response.json();
    const userErrors = json?.data?.productUpdate?.userErrors ?? [];

    if (userErrors.length > 0) {
      console.error("Shopify rejected product update", userErrors);
      return Response.json(
        {
          error: userErrors.map((err) => err?.message).filter(Boolean).join("; ") ||
            "Shopify rejected the update.",
        },
        { status: 400 },
      );
    }

    return Response.json({ success: true, product: json?.data?.productUpdate?.product });
  } catch (error) {
    console.error("Failed to update product content", error);
    return Response.json({ error: error?.message || "Unable to update product content." }, { status: 500 });
  }
};
