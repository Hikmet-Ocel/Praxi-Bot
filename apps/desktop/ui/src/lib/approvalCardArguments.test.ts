import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { ApprovalCardProps } from "../components/ChatCards.tsx";

let server: ViteDevServer;
let ApprovalCard: ComponentType<ApprovalCardProps>;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    logLevel: "error",
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false },
    ssr: { noExternal: ["ui", "@tauri-apps/api"] }
  });
  await server.ssrLoadModule("/src/i18n/index.ts");
  ({ ApprovalCard } = await server.ssrLoadModule("/src/components/ChatCards.tsx"));
});
after(async () => {
  await server?.close();
});

const render = (name: string, input: unknown): string =>
  renderToStaticMarkup(
    createElement(ApprovalCard, {
      tool: {
        kind: "tool",
        key: "c1",
        callId: "c1",
        requestedMs: 1,
        gated: true,
        name,
        input,
        summary: "",
        status: "awaiting_approval"
      } as ApprovalCardProps["tool"],
      onDecide: async () => {}
    })
  );

test("approval cards for fs_delete, email_send and an MCP send show every argument", () => {
  const del = render("fs_delete", { path: "C:/Users/me/Documents/taxes-2025.xlsx" });
  assert.ok(del.includes("fs_delete"), "tool name");
  assert.ok(del.includes("C:/Users/me/Documents/taxes-2025.xlsx"), "path");

  const mail = render("email_send", { to: "boss@example.test", subject: "Resignation", body: "I quit." });
  assert.ok(mail.includes("boss@example.test") && mail.includes("Resignation") && mail.includes("I quit."));

  const mcp = render("use_tool", {
    name: "mcp:gmail/send_message",
    input: { to: "ceo@example.test", text: "wire the money" }
  });
  assert.ok(mcp.includes("gmail.send_message"), "unwrapped tool name");
  assert.ok(mcp.includes("ceo@example.test") && mcp.includes("wire the money"));
});

test("hidden characters in a command and in the input are written as <U+XXXX>, a cut is announced", () => {
  const cmd = render("shell_run", { command: "echo ok\u202Etxt.exe\u200B" });
  assert.ok(cmd.includes("&lt;U+202E&gt;") && cmd.includes("&lt;U+200B&gt;"), cmd);
  assert.ok(!cmd.includes("\u202E") && !cmd.includes("\u200B"));

  const mail = render("email_send", { to: "a@example.test\u2066", body: "x" });
  assert.ok(mail.includes("&lt;U+2066&gt;"));

  assert.ok(render("shell_run", { command: "x".repeat(2500) }).includes("approval-command-shortened"));
  assert.ok(!render("shell_run", { command: "ls" }).includes("approval-command-shortened"));
  assert.ok(render("fs_write", { path: "a", content: "y".repeat(5000) }).includes("approval-input-shortened"));
});
