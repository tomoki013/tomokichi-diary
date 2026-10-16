/**
 * content/*.json → .seed/seed.sql. Validates every entry and fails loudly, so a
 * bad edit never reaches D1. Apply with `pnpm db:seed:local` / `pnpm db:seed`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { columnSql, menuSql, newsSql, storeSql } from "../src/lib/seed.ts";

const root = new URL("../", import.meta.url);
const read = async (name: string) =>
  JSON.parse(await readFile(new URL(`content/${name}.json`, root), "utf8")) as Record<
    string,
    unknown
  >[];

const statements = [
  ...(await menuSql(await read("menus"))),
  ...(await storeSql(await read("stores"))),
  ...(await newsSql(await read("news"))),
  ...(await columnSql(await read("columns"))),
];

await mkdir(new URL(".seed/", root), { recursive: true });
await writeFile(new URL(".seed/seed.sql", root), `${statements.join("\n")}\n`);
console.log(`seed: ${statements.length} rows → .seed/seed.sql`);
