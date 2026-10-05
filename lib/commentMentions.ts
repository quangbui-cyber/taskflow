export type CommentMention = {
  userId: string;
  name: string;
  start: number;
  end: number;
};

/** Only exact, non-overlapping references in the text are accepted. */
export function parseCommentMentions(value: unknown, body: string): CommentMention[] {
  if (!Array.isArray(value)) return [];
  const mentions: CommentMention[] = [];
  for (const entry of value.slice(0, 50)) {
    if (!entry || typeof entry !== "object") continue;
    const { userId, name, start, end } = entry;
    if (
      typeof userId !== "string" || !userId ||
      typeof name !== "string" || !name ||
      !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end <= start || end > body.length ||
      body.slice(start, end) !== `@${name}`
    ) continue;
    mentions.push({ userId, name, start, end });
  }
  mentions.sort((a, b) => a.start - b.start);
  return mentions.filter((mention, index) => index === 0 || mention.start >= mentions[index - 1].end);
}

/** Keep references intact when editing before/after them; remove edited references. */
export function updateCommentMentions(
  previous: string,
  next: string,
  mentions: CommentMention[]
) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let oldEnd = previous.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  return mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    return [];
  });
}

export function mentionQuery(body: string, caret: number) {
  const before = body.slice(0, caret);
  const match = /(?:^|\s)@([^@\n]{0,60})$/.exec(before);
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}
