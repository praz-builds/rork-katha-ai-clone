/**
 * RunPod request construction, kept in one place because both audio functions
 * build URLs against the same endpoint with the same bearer key.
 */

/** MiniMax Speech 02 HD — faithful text-to-speech, public endpoint, no deployment. */
export const RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/minimax-speech-02-hd";

/**
 * RunPod job ids are opaque URL-safe tokens. The bound matters more than the
 * exact shape: anything outside this alphabet cannot appear in a real id, and
 * anything inside it cannot change which path a URL resolves to.
 */
const RUNPOD_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidRunpodJobId(value: unknown): value is string {
  return typeof value === "string" && RUNPOD_JOB_ID.test(value);
}

/**
 * Build the status URL for a job, or return null if the id would take the
 * request anywhere other than this endpoint's own /status/ path.
 *
 * The id arrives as a client-supplied query parameter and the request carries
 * RUNPOD_API_KEY, so a traversal here is an authenticated call to an arbitrary
 * RunPod API on our GPU account. `..` segments are normalized away by the URL
 * parser and `?` or `#` truncate the path, so plain string interpolation is not
 * enough on its own. The alphabet check already excludes all three characters;
 * re-deriving origin and path prefix from the parsed URL is the second lock,
 * because the cost of the first one being subtly wrong is the whole account.
 */
export function runpodStatusUrl(jobId: unknown): string | null {
  if (!isValidRunpodJobId(jobId)) return null;

  const prefix = `${RUNPOD_ENDPOINT}/status/`;
  const expected = new URL(prefix);

  let candidate: URL;
  try {
    candidate = new URL(prefix + jobId);
  } catch {
    return null;
  }

  if (candidate.origin !== expected.origin) return null;
  if (!candidate.pathname.startsWith(expected.pathname)) return null;
  if (candidate.search !== "" || candidate.hash !== "") return null;

  return candidate.toString();
}
