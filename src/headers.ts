import { HOP_BY_HOP } from "./constants.js";
import type { Header } from "./types.js";

const hop = new Set<string>(HOP_BY_HOP);

export function stripHopByHop(headers: Header[]): Header[] {
  return headers
    .filter((header) => header && typeof header.name === "string")
    .map((header) => ({ name: header.name.trim().toLowerCase(), value: String(header.value ?? "") }))
    .filter((header) => header.name && !hop.has(header.name));
}
