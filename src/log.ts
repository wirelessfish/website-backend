import { Config } from "./config.js";
import { format } from "date-fns";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export function log(level: LogLevel, ...data: any[]) {
  if (Config.logging.enabledCategories.includes(level)) {
    console.log(
      format(new Date(), "yyyy/MM/dd HH:mm:ss"),
      `[${level}]`,
      ...data,
    );
  }
}
