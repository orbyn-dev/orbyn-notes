export function configuredAppUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
export function reconnectHref(current: string): string {
  const url = new URL(current);
  url.searchParams.set("connect", "1");
  return url.href;
}
export function plannerTaskHref(
  configured: unknown,
  taskId: string,
  accountId: string,
): string | null {
  const url = configuredAppUrl(configured);
  if (!url) return null;
  url.pathname = url.pathname.replace(/\/?$/, "/") + "tasks";
  url.hash = "";
  url.searchParams.set("orbynTask", taskId);
  url.searchParams.set("orbynAccount", accountId);
  return url.href;
}
