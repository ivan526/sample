import { createServer } from "node:http";
import { createApp } from "./app.mjs";

const port = Number(process.env.MSS_API_PORT || 8787);
const app = createApp();

const server = createServer(async (incoming, outgoing) => {
  const origin = `http://${incoming.headers.host || `localhost:${port}`}`;
  const body = ["GET", "HEAD"].includes(incoming.method || "GET") ? undefined : incoming;
  const request = new Request(new URL(incoming.url || "/", origin), {
    method: incoming.method,
    headers: incoming.headers,
    body,
    duplex: body ? "half" : undefined,
  });
  const result = await app.handle(request);
  outgoing.writeHead(result.status, Object.fromEntries(result.headers.entries()));
  outgoing.end(Buffer.from(await result.arrayBuffer()));
});

server.listen(port, () => {
  process.stdout.write(`MSS API starter listening on http://localhost:${port}\n`);
});
