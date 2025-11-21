import PropTypes from "prop-types";

export const PricingCard = ({
  title,
  description,
  features = [],
  price,
  frequency,
  featuredText,
  button,
}) => {
  return (
    <s-card padding="base" borderRadius="large" style={{ minWidth: "280px", flex: "1 1 0" }}>
      <s-stack direction="block" gap="tight">
        {featuredText && (
          <s-badge tone="info" appearance="subdued">
            {featuredText}
          </s-badge>
        )}
        <s-heading level={3}>{title}</s-heading>
        <s-text appearance="subdued">{description}</s-text>
        <s-heading level={2}>
          {price}
          {frequency ? <s-text appearance="subdued"> / {frequency}</s-text> : null}
        </s-heading>
        <s-stack direction="block" gap="extra-tight">
          {features.map((feature) => (
            <s-stack direction="inline" align="center" gap="tight" key={feature}>
              <s-icon type="check-circle" tone="success" size="small" />
              <s-text>{feature}</s-text>
            </s-stack>
          ))}
        </s-stack>
        {button && (
          <s-button {...(button.props || {})}>{button.content}</s-button>
        )}
      </s-stack>
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
};
