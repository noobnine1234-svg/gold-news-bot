export type FeedConfig = {
  name: string;
  url: string;
  lang: "en" | "th";
};

export type NewsItem = {
  hash: string;
  title: string;
  link: string;
  source: string;
  lang: "en" | "th";
  pubDate: Date | null;
};
