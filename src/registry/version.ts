import crypto from "node:crypto";

/**
 * Create a short build id from a content hash.
 */
export const createBuildId = (contentHash: string) =>
  crypto.createHash("sha256").update(contentHash).digest("hex").slice(0, 8);

/**
 * Convert a base semver into a local registry prerelease version.
 */
export const createRegistryPrereleaseVersion = (
  baseVersion: string,
  buildId: string,
  publishedAt: Date = new Date(),
) => {
  const timestamp = [
    publishedAt.getUTCFullYear(),
    String(publishedAt.getUTCMonth() + 1).padStart(2, "0"),
    String(publishedAt.getUTCDate()).padStart(2, "0"),
  ].join("");

  return `${baseVersion}-nalc.${timestamp}.${buildId}`;
};
