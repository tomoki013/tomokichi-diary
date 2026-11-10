import { McpServer } from "@modelcontextprotocol/server";
import {
  operations,
  type InputSchema,
  type OperationName,
  type OperationSpec,
  type OperationSurface,
} from "@tomokichi/contracts";
import { z, type ZodType } from "zod";

/**
 * The internal MCP servers, built from the operation catalogue
 * (packages/contracts/operations) instead of by hand. Every operation on a
 * surface becomes a tool with the same name, description and input as the
 * admin uses, and runs through the admin API, so the policy, validation and
 * audit trail there apply to it unchanged. Nothing here decides what a
 * connection may do; the API does, and refuses anything else.
 */

/** Runs one operation through the admin API and returns its JSON, or throws its message. */
export type OperationCaller = (name: OperationName, input: unknown) => Promise<unknown>;

export class OperationCallError extends Error {}

/** A caller over `fetch`, for the Service Binding and the local stdio server alike. */
export function operationCaller(
  fetch: (request: Request) => Promise<Response>,
  origin: string,
  headers: Record<string, string> = {},
): OperationCaller {
  return async (name, input) => {
    const response = await fetch(
      new Request(`${origin}/v1/admin/ops/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(input ?? {}),
      }),
    );
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new OperationCallError(
        `${name}: HTTP ${response.status} ${error?.code ?? ""} ${error?.message ?? ""}`.trim(),
      );
    }
    return body;
  };
}

/** The validator's description of a field, as the zod schema MCP clients read. */
export function toZod(schema: InputSchema): ZodType {
  let type: ZodType;
  if (schema.any) type = z.unknown();
  else if (schema.enum) type = z.enum(schema.enum as [string, ...string[]]);
  else
    switch (schema.type) {
      case "string": {
        let text = z.string();
        if (schema.minLength !== undefined) text = text.min(schema.minLength);
        if (schema.maxLength !== undefined) text = text.max(schema.maxLength);
        if (schema.pattern) text = text.regex(new RegExp(schema.pattern));
        type = text;
        break;
      }
      case "number":
      case "integer": {
        let number = schema.type === "integer" ? z.number().int() : z.number();
        if (schema.minimum !== undefined) number = number.min(schema.minimum);
        if (schema.maximum !== undefined) number = number.max(schema.maximum);
        type = number;
        break;
      }
      case "boolean":
        type = z.boolean();
        break;
      case "array": {
        let list = z.array(schema.items ? toZod(schema.items) : z.unknown());
        if (schema.maxItems !== undefined) list = list.max(schema.maxItems);
        type = list;
        break;
      }
      case "object":
        type = z.object(shapeOf(schema));
        break;
      default:
        type = z.unknown();
    }
  if (schema.nullable) type = type.nullable();
  if (schema.description) type = type.describe(schema.description);
  return type;
}

function shapeOf(schema: InputSchema): Record<string, ZodType> {
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, field]) => {
      const type = toZod(field);
      return [key, required.has(key) ? type : type.optional()];
    }),
  );
}

/**
 * What a model should write into a body: the slug alias when a photo has one,
 * so a model picking a field by name cannot write the storage URL.
 */
const swapUrl = (item: Record<string, unknown>) => {
  const { slugUrl, ...rest } = item;
  return { ...rest, url: slugUrl ?? item["url"] };
};

export function bodyUrls(page: unknown): unknown {
  const swap = swapUrl;
  if (!page || typeof page !== "object") return page;
  if ("items" in page && Array.isArray(page.items)) return { ...page, items: page.items.map(swap) };
  return "slugUrl" in page ? swap(page as Record<string, unknown>) : page;
}

const OUTPUT: Partial<Record<OperationName, (value: unknown) => unknown>> = {
  "media.list": bodyUrls,
  "media.upload": bodyUrls,
};

export interface OperationServerOptions {
  readonly name: string;
  readonly surface: Exclude<OperationSurface, "admin-only">;
  /** Whether write tools are listed at all; the API refuses them anyway without the grant. */
  readonly writes: boolean;
  readonly call: OperationCaller;
  readonly instructions?: string;
  /** Added to every result, e.g. how the analytics data must be read. */
  readonly extra?: Record<string, unknown>;
  /** Tool `_meta`, e.g. the OAuth scheme a client should use. */
  readonly meta?: Record<string, unknown>;
}

/** The tools a surface lists, in catalogue order. */
export function toolsFor(
  surface: OperationServerOptions["surface"],
  writes: boolean,
): [OperationName, OperationSpec][] {
  return (Object.entries(operations) as [OperationName, OperationSpec][]).filter(
    ([, spec]) =>
      spec.surface === surface &&
      spec.tool !== undefined &&
      (spec.kind === "read" || (spec.kind === "write" && writes)),
  );
}

export function createOperationServer(options: OperationServerOptions): McpServer {
  const server = new McpServer(
    { name: options.name, version: "2.0.0" },
    options.instructions ? { instructions: options.instructions } : {},
  );
  for (const [name, spec] of toolsFor(options.surface, options.writes)) {
    const tool = spec.tool!;
    const shape = shapeOf(spec.input.schema ?? { type: "object" });
    const confirm = tool.confirm;
    if (confirm)
      shape[confirm.field] = (
        confirm.literal ? z.literal(confirm.literal) : z.string().min(1)
      ).describe(confirm.description);
    const read = spec.kind === "read";
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: spec.description,
        inputSchema: shape,
        annotations: {
          readOnlyHint: read,
          ...(read ? {} : { destructiveHint: tool.destructive ?? false }),
          ...(read && options.surface === "analytics" ? { idempotentHint: true } : {}),
          openWorldHint: spec.publishes === true,
        },
        ...(options.meta ? { _meta: options.meta } : {}),
      },
      async (args: Record<string, unknown>) => {
        const input = { ...args };
        if (confirm) {
          const given = input[confirm.field];
          delete input[confirm.field];
          if (confirm.sameAs && given !== input[confirm.sameAs])
            throw new OperationCallError(
              `${confirm.field} が ${confirm.sameAs} と一致しないため実行しません`,
            );
          if (confirm.literal && given !== confirm.literal)
            throw new OperationCallError(`${confirm.field} に ${confirm.literal} を入れてください`);
        }
        const output = await options.call(name, input);
        const shaped = OUTPUT[name]?.(output) ?? output;
        const data =
          options.extra && shaped && typeof shaped === "object" && !Array.isArray(shaped)
            ? { ...shaped, ...options.extra }
            : shaped;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
          ...(data && typeof data === "object" && !Array.isArray(data)
            ? { structuredContent: data as Record<string, unknown> }
            : {}),
        };
      },
    );
  }
  return server;
}
