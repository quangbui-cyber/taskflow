/** Shared by the extension and server: compare room identity, never passcodes/query strings. */
export const MEETING_TAB_PATTERNS = [
  "https://meet.google.com/*",
  "https://teams.microsoft.com/*",
  "https://teams.live.com/*",
  "https://teams.cloud.microsoft/*",
  "https://zoom.us/*",
  "https://*.zoom.us/*",
  "https://zoom.com/*",
  "https://*.zoom.com/*",
];

/** @param {string | null | undefined} input */
export function parseMeetingLink(input) {
  if (!input) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (host === "meet.google.com") {
    const match = /^\/(?:lookup\/|_meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3}|[a-z]{10})\/?$/i.exec(path);
    if (!match) return null;
    const letters = match[1].toLowerCase().replace(/-/g, "");
    const id = `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
    return { provider: "google", label: "Google Meet", id, key: `google:${id}`, url: url.href };
  }
  if (["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"].includes(host)) {
    let hash;
    try {
      hash = decodeURIComponent(url.hash.slice(1));
    } catch {
      return null;
    }
    const match = /(?:^|\/)l\/meetup-join\/([^/]+)/.exec(path)
      || /(?:^|\/)meet\/([^/?]+)/.exec(path)
      || /(?:^|\/)meet\/([^/?]+)/.exec(hash);
    const id = match?.[1] || url.searchParams.get("threadId");
    if (!id || !/^(?:\d{8,20}|19:[a-zA-Z0-9_+=.@-]+)$/.test(id)) return null;
    // Free/personal Teams IDs are a separate namespace from work/school meetings.
    const namespace = host === "teams.live.com" ? "personal" : "work";
    return { provider: "teams", label: "Microsoft Teams", id, key: `teams:${namespace}:${id}`, url: url.href };
  }
  if (/^(?:[a-z0-9-]+\.)*zoom\.(?:us|com)$/.test(host)) {
    const match = /^\/(?:j|s)\/(\d{9,11})\/?$/.exec(path)
      || /^\/wc\/(?:join\/)?(\d{9,11})(?:\/(?:join|start))?\/?$/.exec(path);
    if (!match) return null;
    const id = match[1];
    return { provider: "zoom", label: "Zoom", id, key: `zoom:${id}`, url: url.href };
  }
  return null;
}

/** @param {ReturnType<typeof parseMeetingLink>} link */
export function meetingLinkTitle(link) {
  return link ? `Họp ${link.label} (${link.provider === "teams" ? "tức thì" : link.id})` : "Cuộc họp tức thì";
}
