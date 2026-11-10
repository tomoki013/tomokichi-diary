import { analyticsOperations } from "./analytics.js";
import { articleOperations } from "./articles.js";
import { curationOperations } from "./curation.js";
import { inquiryOperations } from "./inquiry.js";
import { knowledgeOperations } from "./knowledge.js";
import { mediaOperations } from "./media.js";
import { monetizationOperations } from "./monetization.js";
import { noteOperations } from "./notes.js";
import { siteOperations } from "./site.js";
import type { OperationSpec } from "./spec.js";

export * from "./spec.js";
export * from "./articles.js";
export * from "./notes.js";
export * from "./curation.js";
export * from "./media.js";
export * from "./monetization.js";
export * from "./knowledge.js";
export * from "./site.js";
export * from "./analytics.js";
export * from "./inquiry.js";

/** Every operation there is. The API, the admin and the MCP servers all read this. */
export const operations = {
  ...siteOperations,
  ...articleOperations,
  ...noteOperations,
  ...curationOperations,
  ...mediaOperations,
  ...monetizationOperations,
  ...knowledgeOperations,
  ...analyticsOperations,
  ...inquiryOperations,
};

export type OperationName = keyof typeof operations;
type SpecOf<N extends OperationName> = (typeof operations)[N];

/** What a caller sends. */
export type OperationInput<N extends OperationName> =
  SpecOf<N> extends OperationSpec<unknown, unknown, infer In> ? In : never;
/** What the handler receives, after validation and defaults. */
export type OperationParsed<N extends OperationName> =
  SpecOf<N> extends OperationSpec<infer Parsed, unknown, unknown> ? Parsed : never;
export type OperationOutput<N extends OperationName> =
  SpecOf<N> extends OperationSpec<unknown, infer Output, unknown> ? Output : never;

export const operationNames = Object.keys(operations) as OperationName[];

export function findOperation(name: string): OperationSpec | null {
  return Object.hasOwn(operations, name)
    ? (operations[name as OperationName] as unknown as OperationSpec)
    : null;
}

/**
 * The only operations the MCP servers may not have, and why. A test fails if
 * any other operation is `admin-only`, so "the MCP can do what the admin can"
 * is a property of the code, not a habit.
 */
export const ADMIN_ONLY_OPERATIONS: Readonly<Record<string, string>> = {
  "inquiry.*": "問い合わせ・メールは MCP に出さない（閲覧も不可）",
  "connection.revoke": "MCP 接続の失効は管理画面だけ",
  "knowledge.reviewFact": "事実の確認は管理画面の本人だけ",
};
