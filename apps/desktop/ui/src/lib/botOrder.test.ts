import assert from "node:assert/strict";
import test from "node:test";
import { botOrderFor, makeBotMain, moveBotBy, moveBotTo, orderBots, parseHostBotOrders, withBotOrder } from "./botOrder.ts";

const bots = ["a", "b", "c", "d"].map((id) => ({ id }));

test("orderBots follows the saved order, unknown and new bots keep daemon order at the end", () => {
  assert.deepEqual(orderBots(bots, ["c", "gone", "a"]).map((b) => b.id), ["c", "a", "b", "d"]);
  assert.deepEqual(orderBots(bots, []).map((b) => b.id), ["a", "b", "c", "d"]);
});

test("moveBotTo / moveBotBy reorder, clamp, and make the first id the main bot", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveBotTo(ids, "d", 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveBotBy(ids, "a", -1), ids);
  assert.deepEqual(moveBotBy(ids, "b", 1), ["a", "c", "b", "d"]);
  assert.equal(orderBots(bots, moveBotTo(ids, "c", 0))[0].id, "c");
});

test("the main bot is per computer: ids of another host never change who is first here", () => {
  const hostOrder = ["h-praxi", "h-atlas"];
  const local = ["atlas", "praxi"].map((id) => ({ id }));
  assert.equal(orderBots(local, hostOrder)[0].id, "atlas");
  assert.deepEqual(orderBots(local, makeBotMain(["atlas", "praxi"], "praxi")).map((b) => b.id), ["praxi", "atlas"]);
  assert.deepEqual(makeBotMain(["a", "b"], "a"), ["a", "b"]);
});

test("each computer keeps its own order: Make main on a host never rewrites this computer's list", () => {
  // Same bot ids exist on both computers (e.g. a bot named like a built-in).
  const start = { local: ["atlas", "praxi"], hosts: {} };
  const afterHost = withBotOrder(start, "host-1", makeBotMain(["atlas", "praxi", "laubali"], "praxi"));
  assert.deepEqual(botOrderFor(afterHost, "local"), ["atlas", "praxi"]);
  assert.deepEqual(botOrderFor(afterHost, "host-1"), ["praxi", "atlas", "laubali"]);
  assert.deepEqual(botOrderFor(afterHost, "host-2"), []);
  const afterLocal = withBotOrder(afterHost, "local", ["laubali", "atlas", "praxi"]);
  assert.deepEqual(botOrderFor(afterLocal, "host-1"), ["praxi", "atlas", "laubali"]);
  assert.equal(botOrderFor(afterLocal, "host-2"), botOrderFor(afterLocal, "host-3"));
});

test("parseHostBotOrders keeps only well-formed host lists", () => {
  assert.deepEqual(parseHostBotOrders({ h: ["a", "a", 3, "b"], bad: "x", empty: [] }), { h: ["a", "b"] });
  assert.deepEqual(parseHostBotOrders([["a"]]), {});
  assert.deepEqual(parseHostBotOrders(null), {});
});
