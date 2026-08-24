export type FeedConfig = {
  name: string;
  url: string;
  lang: "en" | "th";
};

export type AppConfig = {
  interval_minutes: number;
  db_path: string;
  max_items_per_cycle: number;
  summary_language: string;
  feeds: FeedConfig[];
  keywords: { strong: string[]; weak: string[] };
};

import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export function loadConfig(path = "./config.yaml"): AppConfig {
  return yaml.load(readFileSync(path, "utf8")) as AppConfig;
}
