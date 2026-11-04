export function noProxyMatches(host: string, noProxy: string | null | undefined): boolean {
  if (!noProxy) return false;
  const target = host.trim().toLowerCase();
  for (const raw of noProxy.split(",")) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    if (item === "*") return true;
    if (target === item || target.endsWith(`.${item}`)) return true;
  }
  return false;
}

export function controlProxyUrl(env: {
  HTTPS_PROXY?: string;
  HTTP_PROXY?: string;
  https_proxy?: string;
  http_proxy?: string;
  NO_PROXY?: string;
  no_proxy?: string;
}, host: string): string | null {
  const noProxy = env.NO_PROXY || env.no_proxy || "";
  if (noProxyMatches(host, noProxy)) return null;
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "";
  return proxy.trim() || null;
}

export function endpointProxyUrl(env: { TF_NANITE_ENDPOINT_PROXY?: string }): string | null {
  const proxy = (env.TF_NANITE_ENDPOINT_PROXY ?? "").trim();
  return proxy || null;
}
