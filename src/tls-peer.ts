import { X509Certificate, createHash } from "node:crypto";
import tls from "node:tls";

export class PeerRejected extends Error {
  constructor(readonly reason: "hostname" | "pin", message: string) {
    super(message);
    this.name = "PeerRejected";
  }
}

export function spkiSha256(cert: tls.PeerCertificate): string {
  if (!cert.raw) throw new PeerRejected("pin", "certificate has no raw encoding");
  const x509 = new X509Certificate(cert.raw);
  return createHash("sha256").update(x509.publicKey.export({ type: "spki", format: "der" })).digest("hex");
}

export function assertPeerCertificate(hostname: string, cert: tls.PeerCertificate, pinHex: string | null): void {
  const hostnameError = tls.checkServerIdentity(hostname, cert);
  if (hostnameError) throw new PeerRejected("hostname", hostnameError.message);
  if (!pinHex) return;
  const actual = spkiSha256(cert);
  if (actual !== pinHex.trim().toLowerCase()) throw new PeerRejected("pin", "SPKI pin mismatch");
}
