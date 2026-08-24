export type FeedConfig = {
  name: string;
  url: string;
  lang: "en" | "th";
  /** true = direct feed from a vetted outlet; items skip reputation resolution */
  trusted?: boolean;
};

export type NewsItem = {
  hash: string;
  title: string;
  link: string;
  source: string;
  lang: "en" | "th";
  pubDate: Date | null;
  /** set when the item came from a vetted direct feed */
  trusted?: boolean;
};
