import http from "node:http";

export type HealthState = {
  enrolled: boolean;
  tenantId: string | null;
  connected: boolean;
  lastHeartbeat: string | null;
  inFlight: number;
  upgradeDeferred: boolean;
};

export function healthBody(state: HealthState): string {
  return JSON.stringify({
    enrolled: state.enrolled,
    tenant_id: state.tenantId,
    connected: state.connected,
    last_heartbeat: state.lastHeartbeat,
    in_flight: state.inFlight,
    upgrade_deferred: state.upgradeDeferred
  });
}

export function startHealthServer(port: number, current: () => HealthState): http.Server {
  const server = http.createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(healthBody(current()));
  });
  server.listen(port, "127.0.0.1");
  return server;
}
