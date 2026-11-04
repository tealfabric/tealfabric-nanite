import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import test from "node:test";
import { assertPeerCertificate, spkiSha256 } from "../src/tls-peer.js";

function certificateFor(hostname: string): Promise<tls.PeerCertificate> {
  const dir = mkdtempSync(join(tmpdir(), "nanite-cert-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  const generated = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert,
    "-days", "1", "-nodes", "-subj", `/CN=${hostname}`,
    "-addext", `subjectAltName=DNS:${hostname}`
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  return new Promise((resolve, reject) => {
    const server = tls.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (socket) => socket.end());
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const client = tls.connect({ host: "127.0.0.1", port, servername: hostname, rejectUnauthorized: false }, () => {
        const peer = client.getPeerCertificate();
        client.end();
        server.close();
        resolve(peer);
      });
      client.on("error", (error) => {
        server.close();
        reject(error);
      });
    });
  });
}

test("a certificate for a different hostname is rejected and a pin mismatch is rejected", async () => {
  const cert = await certificateFor("nanite.example");
  assert.throws(() => assertPeerCertificate("other.example", cert, null), /Hostname/);
  const pin = spkiSha256(cert);
  assert.doesNotThrow(() => assertPeerCertificate("nanite.example", cert, pin));
  assert.throws(() => assertPeerCertificate("nanite.example", cert, "ab".repeat(32)), /SPKI pin mismatch/);
});
