const DRAFT_STORAGE_KEY = "bulkGenerationDrafts";

const safeRead = () => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error("Failed to read draft storage", error);
    return {};
  }
};

const safeWrite = (drafts) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.error("Failed to write draft storage", error);
  }
};

const mergeDraftsIntoStorage = (updates) => {
  if (!updates || typeof updates !== "object") {
    return safeRead();
  }
  const drafts = safeRead();
  Object.entries(updates).forEach(([productId, draft]) => {
    if (!draft) return;
    drafts[productId] = draft;
  });
  safeWrite(drafts);
  return drafts;
};

const removeDraftFromStorage = (productId) => {
  if (!productId) return;
  const drafts = safeRead();
  if (drafts[productId]) {
    delete drafts[productId];
    safeWrite(drafts);
  }
  return drafts;
};

export { safeRead as readDraftsFromStorage, mergeDraftsIntoStorage, removeDraftFromStorage };
