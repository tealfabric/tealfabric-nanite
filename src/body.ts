import { BODY_MAX_BYTES } from "./constants.js";

export function decodedBase64ByteLength(bodyBase64: string): number {
  if (!bodyBase64) return 0;
  const padding = bodyBase64.endsWith("==") ? 2 : bodyBase64.endsWith("=") ? 1 : 0;
  return Math.floor((bodyBase64.length * 3) / 4) - padding;
}

export function exceedsBodyCap(byteLength: number, maxBytes = BODY_MAX_BYTES): boolean {
  return byteLength > maxBytes;
}
