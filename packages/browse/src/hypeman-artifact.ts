import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export type HypemanSource = {
  sourceRepository: string; sourceRevision: string;
  buildRepository: string; buildRevision: string; buildRun: string;
  platform: string;
};
export type HypemanArtifact = {
  version: string; url: string; digest: string; source?: HypemanSource;
};

// Updated only after the exact hosted build and its archive digest are verified.
export const HYPEMAN_ARTIFACTS: Record<string, HypemanArtifact> = {
  darwin_arm64: {
    "version": "source-567335f2effa-4e412b3",
    "url": "https://github.com/possibilities/hypeman/releases/download/source-567335f2effa-4e412b3/hypeman-source-567335f2effa-darwin_arm64.tar.gz",
    "digest": "7c741e923633235d9361f7535f1faddd13b0192a1ae5a30accff2b2d9fb23fb4",
    "source": {
      "sourceRepository": "kernel/hypeman",
      "sourceRevision": "567335f2effa35c9bea6721767b2960ae6609d20",
      "buildRepository": "possibilities/hypeman",
      "buildRevision": "4e412b332c1c67b86e9ea766261afa873879c6ea",
      "buildRun": "40554826201",
      "platform": "darwin_arm64"
    }
  },
  linux_amd64: {
    version: "0.3.0",
    url: "https://github.com/kernel/hypeman/releases/download/v0.3.0/hypeman_0.3.0_linux_amd64.tar.gz",
    digest: "0e704787082e2f5744f55e59b6858085c952f695b5e3cf3d5ea081b1d655c15b",
  },
};

export async function hypemanFileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// Run before signing or executing either binary. The archive digest binds this
// provenance to a reviewed build; file hashes bind its claims to extracted bytes.
export async function verifyHypemanSourcePackage(directory: string, source: HypemanSource): Promise<void> {
  const manifestPath = join(directory, "source-provenance.json");
  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Hypeman source provenance must be a regular file");
  const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Hypeman source provenance is invalid");
  const record = manifest as Record<string, unknown>;
  if (record.schema !== 1 || Object.entries(source).some(([key, value]) => record[key] !== value))
    throw new Error("Hypeman source provenance differs from the reviewed build");
  if (!record.files || typeof record.files !== "object" || Array.isArray(record.files)) throw new Error("Hypeman source file digests are missing");
  const files = record.files as Record<string, unknown>;
  for (const name of ["hypeman-api", "hypeman-token"]) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || typeof files[name] !== "string" || !/^[a-f0-9]{64}$/.test(files[name]))
      throw new Error("Hypeman source package contains an invalid binary or digest");
    if (await hypemanFileDigest(path) !== files[name]) throw new Error(`Hypeman source binary checksum mismatch: ${name}`);
  }
}
