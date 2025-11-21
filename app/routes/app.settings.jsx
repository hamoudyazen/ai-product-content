import { useState } from "react";

const initialPreferences = {
  autoPublish: false,
  emailNotifications: true,
  includeTags: true,
  defaultTone: "Balanced",
};

export default function SettingsPage() {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [savedAt, setSavedAt] = useState("");

  const handleChange = (field, value) => {
    setPreferences((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setSavedAt(new Date().toLocaleTimeString());
  };

  return (
    <s-page heading="Settings">
      <s-section heading="Control how content is generated">
        <s-paragraph>
          Configure the defaults your team wants Shopify to use whenever content
          jobs run. These values are local for now, but ready to be wired to the
          Admin API or your own backend.
        </s-paragraph>
      </s-section>

      <form onSubmit={handleSubmit}>
        <s-stack direction="block" gap="loose">
          <s-card>
            <s-heading level={3}>Automation</s-heading>
            <s-stack direction="block" gap="tight">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={preferences.autoPublish}
                  onChange={(event) => handleChange("autoPublish", event.target.checked)}
                />
                <s-text>Publish generated products automatically</s-text>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={preferences.includeTags}
                  onChange={(event) => handleChange("includeTags", event.target.checked)}
                />
                <s-text>Always include audience tags</s-text>
              </label>
            </s-stack>
          </s-card>

          <s-card>
            <s-heading level={3}>Notifications</s-heading>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={preferences.emailNotifications}
                onChange={(event) => handleChange("emailNotifications", event.target.checked)}
              />
              <s-text>Email me when bulk jobs finish</s-text>
            </label>
          </s-card>

          <s-card>
            <s-heading level={3}>Tone presets</s-heading>
            <label htmlFor="default-tone-select">
              <s-text variant="bodyStrong">Default tone</s-text>
            </label>
            <s-select
              id="default-tone-select"
              name="tone"
              value={preferences.defaultTone}
              onInput={(event) => handleChange("defaultTone", event.target.value)}
            >
              <option value="Balanced">Balanced</option>
              <option value="Playful">Playful</option>
              <option value="Premium">Premium</option>
              <option value="Technical">Technical</option>
            </s-select>
          </s-card>

          <div>
            <s-stack direction="inline" gap="tight" align="center">
              <s-button type="submit" variant="primary">
                Save preferences
              </s-button>
              {savedAt && <s-badge tone="success">Saved at {savedAt}</s-badge>}
            </s-stack>
          </div>
        </s-stack>
      </form>
    </s-page>
  );
}
