import assert from "node:assert/strict";
import { test } from "node:test";
import type { TextItem, TimelineItem, ToolItem, ToolStatus } from "../state/timeline.ts";
import { chainOrderTs, chainSeconds, groupRunItems } from "./thinkingChain.ts";

const text = (key: string, ts: number, t = key): TextItem => ({ kind: "text", key, ts, text: t });
const tool = (key: string, ts: number, status: ToolStatus = "done", name = "web_search"): ToolItem => ({
  kind: "tool",
  key,
  callId: key,
  name,
  input: {},
  status,
  requestedMs: ts,
  completedMs: status === "done" ? ts + 2000 : undefined,
  gated: false
});
const kinds = (items: TimelineItem[], finished: boolean) =>
  groupRunItems(items, finished).map((s) => s.kind);

test("tools and the thoughts before them form one chain; the final text stays", () => {
  const segs = groupRunItems(
    [text("a", 0, "I need data"), tool("t1", 1000), tool("t2", 4000), text("z", 9000, "Answer")],
    true
  );
  assert.deepEqual(segs.map((s) => s.kind), ["chain", "item"]);
  const chain = (segs[0] as { kind: "chain"; chain: import("./thinkingChain.ts").Chain }).chain;
  assert.deepEqual(chain.steps.map((s) => s.kind), ["thought", "tool", "tool"]);
  assert.equal(chain.live, false);
  assert.equal(chainSeconds(chain), 6);
});

test("text with no tool call after it is the answer, not a thought", () => {
  assert.deepEqual(kinds([text("a", 0), text("b", 1)], true), ["item", "item"]);
});

test("an approval request interrupts the chain and is never absorbed", () => {
  assert.deepEqual(
    kinds([tool("t1", 0), tool("t2", 1, "awaiting_approval", "shell_run"), tool("t3", 2, "running")], false),
    ["chain", "item", "chain"]
  );
});

test("subagent calls, questions and todos keep their own rows", () => {
  const q: TimelineItem = { kind: "question", key: "q", callId: "q", question: "?", options: [], requestedMs: 5 };
  assert.deepEqual(
    kinds([tool("t1", 0), tool("s", 1, "done", "spawn_subagent"), q], true),
    ["chain", "item", "item"]
  );
});

test("live only while the run is unfinished; failures are counted", () => {
  const run = groupRunItems([tool("t1", 0), tool("t2", 1, "error")], false);
  const c = (run[0] as { kind: "chain"; chain: import("./thinkingChain.ts").Chain }).chain;
  assert.equal(c.live, true);
  assert.equal(c.problems, 1);
  const done = groupRunItems([tool("t1", 0), tool("t2", 1, "error")], true);
  assert.equal((done[0] as { kind: "chain"; chain: import("./thinkingChain.ts").Chain }).chain.live, false);
});

test("a chain followed by the streaming answer is not live", () => {
  const segs = groupRunItems([tool("t1", 0), text("a", 5000, "partial")], false);
  assert.equal((segs[0] as { kind: "chain"; chain: import("./thinkingChain.ts").Chain }).chain.live, false);
});

test("a long or multi-line text before a tool call stays the answer, not a thought", () => {
  const long = "x".repeat(400);
  assert.deepEqual(kinds([text("a", 0, long), tool("t1", 1000)], true), ["item", "chain"]);
  assert.deepEqual(kinds([text("a", 0, "## Summary\n| a | b |"), tool("t1", 1000)], true), ["item", "chain"]);
});

test("the first chain counts the model time before its first call", () => {
  const segs = groupRunItems([tool("t1", 40000)], true, 10000);
  const c = (segs[0] as { kind: "chain"; chain: import("./thinkingChain.ts").Chain }).chain;
  assert.equal(chainSeconds(c), 32);
  const second = groupRunItems([tool("t1", 40000), text("m", 50000, "long ".repeat(80)), tool("t2", 60000)], true, 10000);
  const c2 = (second[2] as { kind: "chain"; chain: import("./thinkingChain.ts").Chain }).chain;
  assert.equal(c2.spanStartMs, 60000);
  assert.equal(groupRunItems([tool("t1", 1000)], true, 5000)[0]?.kind, "chain");
});

test("a chain sorts at its end, never after the next row nor before its start", () => {
  const chain = { startMs: 1000, endMs: 9000 };
  assert.equal(chainOrderTs(chain), 9000);
  assert.equal(chainOrderTs(chain, 5000), 5000);
  assert.equal(chainOrderTs(chain, 500), 1000);
});

test("find_tool / get_tool_details never appear as steps and do not split a chain", () => {
  const items = [
    tool("a", 1, "done", "find_tool"),
    tool("b", 2, "done", "get_tool_details"),
    tool("c", 3, "done", "use_tool"),
    text("t", 5, "Done.")
  ];
  const segs = groupRunItems(items, true);
  assert.equal(segs.length, 2);
  const chain = segs[0];
  assert.ok(chain && chain.kind === "chain");
  assert.deepEqual(chain.chain.steps.map((s) => s.key), ["c"]);
  // only plumbing: no chain at all
  assert.deepEqual(kinds([tool("a", 1, "done", "find_tool")], true), []);
});

test("a refused call is the owner's decision, not a failed step; an errored or expired one is", () => {
  const chainOf = (statuses: ToolStatus[]) =>
    (groupRunItems(statuses.map((s, i) => tool(`t${i}`, i * 1000, s)), true)[0] as {
      chain: import("./thinkingChain.ts").Chain;
    }).chain;
  assert.equal(chainOf(["done", "denied"]).problems, 0);
  assert.equal(chainOf(["error", "expired", "denied"]).problems, 2);
});
