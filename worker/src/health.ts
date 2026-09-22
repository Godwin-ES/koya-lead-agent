import { createServer, type Server } from "node:http";

/**
 * A minimal health endpoint for the deployment platform's health checks
 * (Task 16 Step 3) - the worker has no other reason to listen on a port,
 * it's a background poll loop, not a request handler.
 */
export function startHealthServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port);
  return server;
}
