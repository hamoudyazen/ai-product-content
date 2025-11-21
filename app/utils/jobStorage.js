const JOB_STORAGE_KEY = "bulkGenerationJobs";
// Allow plenty of time for async jobs to finish before forcing completion.
const JOB_COMPLETION_DELAY_MS = 1000 * 60 * 30; // 30 minutes

const getJobWorkItemCount = (job) => {
  const productCount = job?.selection?.products ?? 0;
  const collectionCount = job?.selection?.collections ?? 0;
  const typeCount = job?.types?.length ?? 0;
  return (productCount + collectionCount) * typeCount;
};

const readJobs = () => {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(JOB_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("Failed to read jobs", error);
    return [];
  }
};

const dispatchJobsUpdated = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("bulk-jobs-updated"));
};

const saveJobs = (jobs) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(jobs));
    dispatchJobsUpdated();
  } catch (error) {
    console.error("Failed to save jobs", error);
  }
};

const finalizeExpiredJobs = (jobs) => {
  const now = Date.now();
  let changed = false;
  const updated = jobs.map((job) => {
    if (
      job.status === "processing" &&
      typeof job.createdAtMs === "number" &&
      now - job.createdAtMs >= JOB_COMPLETION_DELAY_MS
    ) {
      changed = true;
      return {
        ...job,
        status: "completed",
        workItemCount: job.workItemCount ?? getJobWorkItemCount(job),
        completedItems: job.workItemCount ?? getJobWorkItemCount(job),
      };
    }
    return job;
  });
  return { jobs: updated, changed };
};

const ensureTimerRegistry = () => {
  if (typeof window === "undefined") return null;
  if (!window.__bulkJobTimers) {
    window.__bulkJobTimers = {};
  }
  return window.__bulkJobTimers;
};

const markJobCompletedInStorage = (jobId) => {
  const jobs = readJobs();
  let changed = false;
  const updated = jobs.map((job) => {
    if (job.id === jobId && job.status !== "completed") {
      changed = true;
      return {
        ...job,
        status: "completed",
        workItemCount: job.workItemCount ?? getJobWorkItemCount(job),
        completedItems: job.workItemCount ?? getJobWorkItemCount(job),
      };
    }
    return job;
  });
  if (changed) {
    saveJobs(updated);
  }
};

const ensureBackgroundCompletion = (job) => {
  if (job.status === "completed") return;
  const timers = ensureTimerRegistry();
  if (!timers || timers[job.id]) return;
  const now = Date.now();
  const createdAt = typeof job.createdAtMs === "number" ? job.createdAtMs : now;
  const elapsed = now - createdAt;
  const remaining = Math.max(JOB_COMPLETION_DELAY_MS - elapsed, 0);
  timers[job.id] = window.setTimeout(() => {
    markJobCompletedInStorage(job.id);
    delete timers[job.id];
  }, remaining);
};

const loadJobsFromStorage = () => {
  const jobs = readJobs();
  const { jobs: finalizedJobs, changed } = finalizeExpiredJobs(jobs);
  if (changed) {
    saveJobs(finalizedJobs);
  }
  finalizedJobs
    .filter((job) => job.status === "processing")
    .forEach((job) => ensureBackgroundCompletion(job));
  return finalizedJobs;
};

const addJobToStorage = (job) => {
  const jobs = loadJobsFromStorage();
  const updated = [job, ...jobs];
  saveJobs(updated);
  ensureBackgroundCompletion(job);
};

const updateJobInStorage = (jobId, updates) => {
  const jobs = readJobs();
  let changed = false;
  const updated = jobs.map((job) => {
    if (job.id === jobId) {
      changed = true;
      return {
        ...job,
        ...(typeof updates === "function" ? updates(job) : updates),
      };
    }
    return job;
  });
  if (changed) {
    saveJobs(updated);
  }
  return changed;
};

export {
  JOB_STORAGE_KEY,
  JOB_COMPLETION_DELAY_MS,
  addJobToStorage,
  getJobWorkItemCount,
  loadJobsFromStorage,
  saveJobs,
  markJobCompletedInStorage,
  updateJobInStorage,
};
