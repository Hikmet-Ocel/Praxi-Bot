import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const block = (css: string, selector: string) => {
  const start = css.indexOf(`
${selector} {`);
  assert.ok(start >= 0, `${selector} rule exists`);
  return css.slice(start, css.indexOf("}", start));
};

test("the main column clips, so scrollIntoView can never scroll the title bar away", () => {
  assert.match(block(read("../App.module.css"), ".mainColumn"), /overflow:\s*clip/);
});

test("the bot panel button row keeps every button on one row", () => {
  const actions = block(read("../components/BotPanel.module.css"), ".actions");
  assert.match(actions, /grid-auto-flow:\s*column/);
  assert.doesNotMatch(actions, /grid-template-columns:\s*1fr auto auto/);
});

test("the pause button stretches inside its card row", () => {
  assert.match(read("../components/BotComputerBlock.module.css"), /\.control > button\s*\{[^}]*flex:\s*1 1 auto/);
});

test("App saves the order of the ACTIVE computer only", () => {
  const app = read("../App.tsx");
  assert.match(app, /hostBotOrders: \{ \.\.\.settings\.hostBotOrders, \[activeComputerId\]: next \}/);
  assert.doesNotMatch(app, /updateSettings\(\{ botOrder: makeBotMain/);
});
