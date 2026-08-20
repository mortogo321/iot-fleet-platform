/** Real-clock sleep. Callers that need determinism (e.g. OTA sequencing) inject their own. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
