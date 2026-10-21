import WebSocket from "ws";

/** Private owner channel. Commands are audited by Hypeman: never put credentials in argv. */
export function guestExec(connection: { baseUrl: string; token: string }, instanceId: string, command: string[], timeout = 30, maxBytes = 1024 * 1024): Promise<Buffer> {
  const url = new URL(`/instances/${encodeURIComponent(instanceId)}/exec`, connection.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${connection.token}` }, handshakeTimeout: 5000, maxPayload: 1024 * 1024, followRedirects: false });
    const chunks: Buffer[] = []; let size = 0, settled = false;
    const done = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); socket.terminate(); error ? reject(error) : resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => done(new Error("Guest command outcome unknown")), (timeout + 10) * 1000);
    socket.on("error", () => done(new Error("Guest command connection failed")));
    socket.on("close", () => done(new Error("Guest command disconnected before completion")));
    socket.on("open", () => socket.send(JSON.stringify({ command, tty: false, timeout, wait_for_agent: 5 })));
    socket.on("message", (raw, binary) => {
      if (binary) { const data = Buffer.from(raw as Buffer); size += data.length; if (size > maxBytes) done(new Error("Guest command output exceeds limit")); else chunks.push(data); }
      else { try { const result = JSON.parse(String(raw)); done(result.exitCode === 0 ? undefined : new Error("Guest command failed")); } catch { done(new Error("Invalid guest command response")); } }
    });
  });
}
