import WebSocket from "ws";

/** Owner-internal CDP against an already verified owned relay. No page contents or credentials are logged. */
export async function browserCommand(source: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const origin = new URL(source);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/" || origin.username || origin.password) throw new Error("Expected owned loopback CDP relay");
  const response = await fetch(source + "/json/version", { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Browser CDP discovery unavailable");
  const data = await response.json() as { webSocketDebuggerUrl: string }, url = new URL(data.webSocketDebuggerUrl);
  if (url.protocol !== "ws:" || url.host !== origin.host || !/^\/devtools\/browser\/[\w-]+$/.test(url.pathname)) throw new Error("Browser CDP identity changed");
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: 5000, maxPayload: 1024 * 1024, followRedirects: false });
    let settled = false;
    const done = (error?: Error, result?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); socket.terminate(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { socket.terminate(); done(new Error("Browser command outcome unknown")); }, 10000);
    socket.on("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.on("error", () => done(new Error("Browser command connection failed")));
    socket.on("close", () => done(new Error("Browser command connection closed")));
    socket.on("message", raw => { try { const value = JSON.parse(String(raw)); if (value.id === 1) done(value.error ? new Error(`Browser refused ${method}`) : undefined, value.result); } catch { done(new Error("Invalid browser command reply")); } });
  });
}
