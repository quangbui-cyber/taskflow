import { Fragment } from "react";
import { parseCommentMentions, type CommentMention } from "@/lib/commentMentions";

export default function CommentBody({ body, mentions }: { body: string; mentions: CommentMention[] }) {
  const validMentions = parseCommentMentions(mentions, body);
  const parts = validMentions.map((mention, index) => {
    const previousEnd = index ? validMentions[index - 1].end : 0;
    const text = body.slice(previousEnd, mention.start);
    return (
      <Fragment key={`${mention.userId}-${mention.start}`}>
        {text}
        <span className="rounded bg-brand-50 px-0.5 font-medium text-brand-800">{body.slice(mention.start, mention.end)}</span>
      </Fragment>
    );
  });
  const finalEnd = validMentions.at(-1)?.end ?? 0;
  return <p className="whitespace-pre-wrap break-words text-sm text-zinc-700">{parts}{body.slice(finalEnd)}</p>;
}
