import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Official Kernel image 6f92f2c, linux/amd64 manifest. Unlike the general
// Browser image, it includes the legacy netfilter tools research requires.
export const RESEARCH_IMAGE = "docker.io/onkernel/chromium-headful@sha256:a92a8393467ce662b9c76d0c4c51e3836bd5ada5a1ceea37375d616a6526d887";

/** Hypeman's ARM64 kernel omits xt_owner but supports loadable modules. Use
 * its unmodified matching upstream module only when owner matching is absent;
 * an incompatible kernel or failed load aborts before Chrome starts. */
export function prepareResearchRuntime(): string {
  const module = readFileSync(new URL("../resources/research-kernel/xt_owner-aarch64.ko", import.meta.url));
  if (createHash("sha256").update(module).digest("hex") !== "a1c904ff34b1a415ad3058b9ba357be27eea53812e69b8b620348b5e8fdc797f")
    throw new Error("research firewall module integrity check failed");
  return `command -v iptables >/dev/null; if ! iptables -m owner --help >/dev/null 2>&1; then python3 -c 'import base64,ctypes
data=base64.b64decode("${module.toString("base64")}")
libc=ctypes.CDLL(None,use_errno=True)
result=libc.init_module(ctypes.c_char_p(data),ctypes.c_ulong(len(data)),ctypes.c_char_p(b""))
if result != 0: raise OSError(ctypes.get_errno(),"research firewall module load failed")'; fi; iptables -m owner --help >/dev/null`;
}
