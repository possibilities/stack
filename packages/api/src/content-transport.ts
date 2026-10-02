/** Content's two loopback listeners and their optional public origins. */
export const CONTENT_DOCUMENT_PORT = 8777;
export const CONTENT_ARTIFACT_PORT = 8778;
const CONTENT_HOST = "127.0.0.1";

export interface ContentTransportConfig {
  host: typeof CONTENT_HOST;
  port: number;
  artifactPort: number;
  documentOrigin?: string;
  artifactOrigin?: string;
}

function port(env: NodeJS.ProcessEnv, primary: string, legacy: string, fallback: number): number {
  const name = env[primary] === undefined ? legacy : primary;
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (raw?.trim() === "" || !Number.isInteger(value) || value < 0 || value > 65535)
    throw new Error(`${name} must be a port from 0 to 65535`);
  return value;
}

function publicOrigin(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTP(S) origin`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || value !== url.origin || url.port === "0")
    throw new Error(`${name} must be a canonical HTTP(S) origin with a nonzero port and no path, credentials or query`);
  return url.origin;
}

export function contentTransportConfig(env: NodeJS.ProcessEnv): ContentTransportConfig {
  if ((env.STACK_CONTENT_HOST ?? CONTENT_HOST) !== CONTENT_HOST)
    throw new Error("Content backend must bind 127.0.0.1; configure remote clients through Access");
  const documentPort = port(env, "STACK_CONTENT_PORT", "STACK_WIKI_PORT", CONTENT_DOCUMENT_PORT);
  const artifactPort = port(env, "STACK_CONTENT_ARTIFACT_PORT", "STACK_WIKI_ARTIFACT_PORT", CONTENT_ARTIFACT_PORT);
  if (documentPort !== 0 && documentPort === artifactPort) throw new Error("content document and artifact ports must differ");
  const documentOrigin = publicOrigin(env.STACK_CONTENT_DOCUMENT_ORIGIN, "STACK_CONTENT_DOCUMENT_ORIGIN");
  const artifactOrigin = publicOrigin(env.STACK_CONTENT_ARTIFACT_ORIGIN, "STACK_CONTENT_ARTIFACT_ORIGIN");
  if ((documentOrigin === undefined) !== (artifactOrigin === undefined)) throw new Error("content document and artifact origins must be configured together");
  if (documentOrigin && documentOrigin === artifactOrigin) throw new Error("content document and artifact origins must differ");
  return { host: CONTENT_HOST, port: documentPort, artifactPort, ...(documentOrigin ? { documentOrigin, artifactOrigin } : {}) };
}

/** A zero listen port has no address until the listener reports its assigned port. */
export function contentListenerOrigin(port: number): string | null {
  return port === 0 ? null : new URL(`http://${CONTENT_HOST}:${port}`).origin;
}

/** Public links are available only when both isolated origins are known. */
export function contentPublicOrigins(config: ContentTransportConfig): { document: string; artifact: string } | null {
  const document = config.documentOrigin ?? contentListenerOrigin(config.port);
  const artifact = config.artifactOrigin ?? contentListenerOrigin(config.artifactPort);
  return document && artifact ? { document, artifact } : null;
}
