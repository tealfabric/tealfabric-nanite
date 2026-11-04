export type AllowlistEntry = {
  scheme: "http" | "https";
  host: string;
  port: number;
};

export type Header = { name: string; value: string };

export type AllowlistDocument = {
  generation: number;
  entries: AllowlistEntry[];
};

export type PreparedRequest = {
  method: string;
  url: string;
  headers: Header[];
  body: Buffer;
};
