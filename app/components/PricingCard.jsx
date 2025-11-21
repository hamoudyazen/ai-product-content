import PropTypes from "prop-types";

export const PricingCard = ({
  title,
  description,
  features = [],
  price,
  frequency,
  featuredText,
  button,
  isCurrent = false,
}) => {
  const highlightStyle = isCurrent
    ? {
        border: "2px solid var(--p-color-border, #0C69FF)",
        boxShadow: "0 12px 25px rgba(0, 102, 255, 0.18)",
      }
    : {
        border: "1px solid var(--p-color-border-subdued, #D0D5DD)",
        boxShadow: "0 6px 16px rgba(15, 23, 42, 0.12)",
      };
  return (
    <s-card
      padding="extra-loose"
      borderRadius="large"
      style={{
        minWidth: "280px",
        flex: "1 1 0",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: "0.75rem",
        background: "var(--p-color-bg-surface)",
        transition: "transform 150ms ease, box-shadow 150ms ease",
        position: "relative",
        overflow: "hidden",
        ...highlightStyle,
        padding: "1.25rem",
        borderRadius: "1.25rem",
        paddingBottom: button ? "1rem" : undefined,
      }}
      onMouseEnter={(event) => {
        const target = event.currentTarget;
        target.style.transform = "translateY(-3px)";
        target.style.boxShadow = "0 18px 30px rgba(15, 23, 42, 0.22)";
      }}
      onMouseLeave={(event) => {
        const target = event.currentTarget;
        target.style.transform = "";
        target.style.boxShadow = highlightStyle.boxShadow;
      }}
    >
      <s-stack direction="block" gap="tight">
        {featuredText && (
          <s-badge tone="info" appearance="subdued" style={{ letterSpacing: "0.12em" }}>
            {featuredText}
          </s-badge>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <s-text variant="headingLg" type="strong">
            {title}
          </s-text>
          {isCurrent && (
            <s-chip tone="success" size="small">
              Current
            </s-chip>
          )}
        </div>
        <s-text appearance="subdued" style={{ marginBottom: "0.25rem" }}>
          {description}
        </s-text>
        <s-stack direction="inline" align="baseline" gap="tight" style={{ marginTop: "0.25rem" }}>
          <s-heading level={1} style={{ margin: 0 }}>
            {price}
          </s-heading>
          {frequency ? (
            <s-text appearance="subdued" style={{ fontSize: "0.95rem" }}>
              / {frequency}
            </s-text>
          ) : null}
        </s-stack>
        <s-divider />
        <s-stack direction="block" gap="xsmall">
          {features.map((feature) => (
            <s-stack
              direction="inline"
              align="center"
              gap="xsmall"
              key={feature}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: "0.5rem",
                background: "var(--p-color-bg-surface-secondary, #F7F7FB)",
                border: "1px solid transparent",
                transition: "border-color 150ms ease",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = "var(--p-color-border)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = "transparent";
              }}
            >
              <s-icon type="check-circle" tone="success" size="small" />
              <s-text>{feature}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-stack>
      {button && (
        <s-button
          {...(button.props || {})}
          style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
        >
          {button.content}
        </s-button>
      )}
    </s-card>
  );
};

PricingCard.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  features: PropTypes.arrayOf(PropTypes.string),
  price: PropTypes.string.isRequired,
  frequency: PropTypes.string,
  featuredText: PropTypes.string,
  button: PropTypes.shape({
    content: PropTypes.node,
    props: PropTypes.object,
  }),
  isCurrent: PropTypes.bool,
};
