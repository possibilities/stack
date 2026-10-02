/** One spelling of every URL, shared by `publish`, `open`, the stub documents
 * and the server — a link written into the vault must still resolve years
 * later, so the shapes live here rather than in whichever module builds one. */

import { contentListenerOrigin } from "@stack/api";

/** Moves as new versions land: what a human wants bookmarked. */
export function latestArtifactUrl(name: string): string {
  return `/a/${name}/`;
}

/** Immutable: safe to cite, safe to cache forever. */
export function versionArtifactUrl(name: string, version: string): string {
  return `/a/${name}/v/${version}/`;
}

export function documentUrl(slug: string): string {
  return `/d/${slug}`;
}

export function absolute(port: number, path: string): string {
  const origin = contentListenerOrigin(port);
  if (!origin) throw new Error("Content listener port is unresolved");
  return `${origin}${path}`;
}
