import { Hono } from "hono";
import { validate, v } from "@tomokichi/contracts";
import { listContactMessages, setContactMessageStatus } from "@tomokichi/application";
import type { ContactMessageId } from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

const statusSchema = v.object({ status: v.literalUnion(["unread", "read", "spam"] as const) });

export function messageRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const messages = await listContactMessages(c.get("ctx"));
    return c.json({
      items: messages.map((message) => ({
        id: message.id,
        name: message.name,
        email: message.email,
        subject: message.subject,
        body: message.body,
        status: message.status,
        createdAt: message.createdAt,
      })),
      unread: messages.filter((message) => message.status === "unread").length,
    });
  });

  routes.put("/:id/status", async (c) => {
    const parsed = validate(statusSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);

    await setContactMessageStatus(
      c.get("ctx"),
      c.req.param("id") as ContactMessageId,
      parsed.value.status,
    );
    return c.json({ ok: true });
  });

  return routes;
}
