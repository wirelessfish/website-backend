import "dotenv/config";
import { defineConfig } from "drizzle-kit";
const DB_FILE_NAME = process.env.DB_FILE_NAME;
if (!DB_FILE_NAME)
    throw new Error("DB_FILE_NAME not set");
export default defineConfig({
    out: "./drizzle",
    dialect: "sqlite",
    schema: "./src/db/schema.ts",
    dbCredentials: {
        url: DB_FILE_NAME,
    },
});
