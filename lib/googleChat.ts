export type GoogleChatResult = { ok: true } | { ok: false; error: string };

type OpenLink = { openLink: { url: string } };

/** Biểu tượng có sẵn của Google Chat (knownIcon). */
export type GoogleChatIcon = "BOOKMARK" | "PERSON" | "CLOCK" | "MEMBERSHIP" | "DESCRIPTION" | "MULTIPLE_PEOPLE";

export type GoogleChatButton = {
  text: string;
  onClick: OpenLink;
  type?: "FILLED" | "OUTLINED" | "BORDERLESS";
};

export type GoogleChatWidget =
  | { textParagraph: { text: string } }
  | {
      decoratedText: {
        topLabel?: string;
        text: string;
        bottomLabel?: string;
        wrapText: boolean;
        startIcon?: { knownIcon: GoogleChatIcon };
        onClick?: OpenLink;
      };
    }
  | { buttonList: { buttons: GoogleChatButton[] } }
  | { divider: Record<string, never> };

export type GoogleChatSection = { header?: string; widgets: GoogleChatWidget[] };

export type GoogleChatMessage = {
  text?: string;
  fallbackText?: string;
  cardsV2?: {
    cardId: string;
    card: {
      header: { title: string; subtitle: string };
      sections: GoogleChatSection[];
    };
  }[];
};
