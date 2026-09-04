import catalogJson from "../../../export/knowledge/catalog.json";
import { searchKnowledgeCatalog, type KnowledgeCatalogEntry } from "@tomokichi/application";

export const catalog = catalogJson as readonly KnowledgeCatalogEntry[];

export function queryCatalog(input: {
  query?: string;
  provenance?: "firsthand" | "official" | "researched" | "derived";
  kind?:
    | "visit"
    | "food_drink"
    | "transport"
    | "cost"
    | "duration"
    | "procedure"
    | "observation"
    | "recommendation"
    | "warning"
    | "current_fact";
}) {
  return searchKnowledgeCatalog(catalog, input);
}
