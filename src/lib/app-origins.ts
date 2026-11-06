const LOCAL_HOST_ALIASES = new Map([
  ["localhost", "127.0.0.1"],
  ["127.0.0.1", "localhost"],
]);

export function getAppOrigins() {
  const appUrl = process.env.BETTER_AUTH_URL;
  if (!appUrl) throw new Error("BETTER_AUTH_URL is required");

  const url = new URL(appUrl);
  const origins = [url.origin];
  const alias = LOCAL_HOST_ALIASES.get(url.hostname);
  if (url.protocol === "http:" && alias) {
    origins.push(`${url.protocol}//${alias}${url.port ? `:${url.port}` : ""}`);
  }
  return origins;
}
