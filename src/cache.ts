import { addMilliseconds } from "date-fns";
import { Config } from "./config.js";
import ms from "ms";
import { log } from "./log.js";

const cacheMap = new Map<string, { ttl: Date; data: any }>();

export function cacheGet(key: string): any {
  let v = cacheMap.get(key);
  let now = new Date();

  if (!v) {
    return;
  }

  if (v.ttl.getTime() < now.getTime()) {
    cacheMap.delete(key);
    return;
  }

  //   log("DEBUG", "Cache hit", key);
  return v.data;
}

export function cache(key: string, value: any, ttl: ms.StringValue) {
  //   log("DEBUG", "Cache set", key, "with ttl", ttl);

  const now = new Date();
  const ttlDate = addMilliseconds(now, ms(ttl));

  if (cacheMap.size >= Config.cacheMaxEntries) {
    cacheMap.delete(cacheMap.keys().next().value!);
  }

  cacheMap.set(key, { ttl: ttlDate, data: value });
}
