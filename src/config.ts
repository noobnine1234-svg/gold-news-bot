export type AppConfig = {
  interval_minutes: number;
  db_path: string;
  max_items_per_cycle: number;
  quality_threshold: number;
  delete_after_hours: number;
};

import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// Tunables live in config.yaml; the feed list + vocabulary are shared with the
// Cloudflare Worker via src/sources.ts.
export function loadConfig(path = "./config.yaml"): AppConfig {
  return yaml.load(readFileSync(path, "utf8")) as AppConfig;
}
