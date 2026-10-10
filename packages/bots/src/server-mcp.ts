import { internalMcpLaunches, type McpStdioLaunch, type PackageRole } from "@stack/api";

/** Resolve the server's default MCP fleet at each bot launch. */
export async function serverMcpLaunches(root: string, port: number, botId: string, endpoint: string, role: PackageRole,
  env: NodeJS.ProcessEnv = process.env): Promise<Record<string, McpStdioLaunch>> {
  return internalMcpLaunches(root, { kind: "bot", botId, endpoint, role }, { ...env, STACK_MCP_PORT: String(port) });
}
