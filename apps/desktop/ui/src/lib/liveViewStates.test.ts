import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ControlStateDto, TakeoverInfo, TargetInfo } from "../api/types.ts";
import { runClearPause } from "./liveViewRelease.ts";
import { createSnapshotSequencer } from "./snapshotOrder.ts";
import {
  applyControlStateDto,
  applyFrameRendered,
  applyReleaseFailed,
  applyReleaseStarted,
  applySessionCreated,
  applyStatusRecord,
  applyStreamDisconnected,
  applyTakeoverAccepted,
  applyTakeoverStarted,
  buildSessionHeartbeat,
  canSendLiveInput,
  createInitialLiveViewState,
  foreignPausedTakeover,
  isActivelyOwningTakeover,
  isLocalBaseUrl,
  markRemoteBaseUrl,
  RELEASE_LEASE_MAX_MS,
  sessionProfile,
  visibleActions,
  type LiveViewControllerState
} from "./liveViewState.ts";
import type { FrameHeader, StatusHeader } from "./liveViewWire.ts";

const NIL = "00000000-0000-0000-0000-000000000000";

const target: TargetInfo = {
  target_id: "t-1",
  bot_id: "bot-1",
  run_id: "run-1",
  host_id: "local",
  kind: "browser",
  generation: 2,
  capabilities: { codecs: ["jpeg"], view: true, input: true, reason: null },
  unavailable_reason: null
};
const session = {
  session_id: "sess-1",
  generation: 2,
  expires_in_ms: 20_000,
  input_capabilities: true,
  effective_profile: {
    profile: "watch" as const,
    codec: "jpeg" as const,
    max_width: 960,
    max_height: 600,
    max_fps: 1,
    quality: 60,
    burst_bytes: 2_000_000,
    bytes_per_second: 1_000_000
  },
  stream_url: "/v1/view/sessions/sess-1/frames"
};
const frame: FrameHeader = {
  v: 1,
  type: "frame",
  session_id: "sess-1",
  sent_at_ms: 1,
  target_id: "t-1",
  generation: 2,
  frame_seq: 1,
  captured_at_ms: 1,
  cause: "refresh",
  action_seq: null,
  codec: "jpeg",
  width: 1280,
  height: 800,
  source_rect: { x: 0, y: 0, width: 1280, height: 800, units: "physical_px" },
  geometry_revision: 7,
  repeated: false
};
const statusActive: StatusHeader = {
  v: 1,
  type: "status",
  session_id: "sess-1",
  state: "active",
  reason: null,
  effective_profile: { ...session.effective_profile, profile: "live" },
  control_epoch: 5,
  input_allowed: true
};

const tk = (over: Partial<TakeoverInfo> = {}): TakeoverInfo => ({
  id: "to-1",
  control_epoch: 5,
  input_expires_in_ms: 10_000,
  owner: "local-ui:1",
  reason: null,
  session_id: "sess-1",
  state: "active",
  target_id: "t-1",
  ...over
});
const dto = (t: TakeoverInfo | null, latched: ControlStateDto["latched"] = null): ControlStateDto => ({
  app_connected: true,
  expires_in_ms: 15_000,
  latched: latched ?? (t ? "human_driving" : null),
  mode: t ? "human_driving" : "idle",
  release: null,
  takeover: t
});
const foreign = (reason: TakeoverInfo["reason"] = "local_override") =>
  dto(
    tk({ id: NIL, session_id: NIL, control_epoch: 0, owner: "peer:phone", state: "paused", reason }),
    "paused"
  );

const watching = () =>
  applyFrameRendered(
    applySessionCreated(createInitialLiveViewState(target), target, session),
    frame,
    1000
  );
const owning = (): LiveViewControllerState => {
  let st = applyTakeoverAccepted(watching(), {
    takeover_id: "to-1",
    control_epoch: 5,
    state: "active"
  });
  st = applyStatusRecord(st, statusActive, 1010);
  return st;
};

// ---- the reviewer's state table as an acceptance contract ------------------

interface Row {
  name: string;
  state: LiveViewControllerState;
  control: ControlStateDto | null;
  /** (a) input is stopped or can be stopped */
  stopsInput: (s: LiveViewControllerState, a: ReturnType<typeof visibleActions>) => boolean;
  /** (b) hand back, or the hand-back is gone / not applicable */
  handBack: (s: LiveViewControllerState, a: ReturnType<typeof visibleActions>) => boolean;
  /** (c) a visible way to unpause (or nothing is paused) */
  unpause: (s: LiveViewControllerState, a: ReturnType<typeof visibleActions>) => boolean;
  expectDock: string[];
  expectPanel: string[];
  expectBanner: string[];
}

const blocked = (s: LiveViewControllerState) => !canSendLiveInput(s, 5000).ok;
const hasStop = (a: ReturnType<typeof visibleActions>) => a.dock.includes("stop");

const pausedOwn = (reason: TakeoverInfo["reason"]) =>
  applyControlStateDto(applyStreamDisconnected(owning()), dto(tk({ state: "paused", reason }), "paused"));
const pendingFailed = () =>
  applyReleaseFailed(applyReleaseStarted(owning(), "req-1", null), "release_failed", "x");

const rows: Row[] = [
  {
    name: "watch, no takeover",
    state: watching(),
    control: dto(null),
    stopsInput: (s) => blocked(s),
    handBack: () => true, // nothing to hand back
    unpause: () => true, // nothing paused
    expectDock: ["stop"],
    expectPanel: ["open_screen"],
    expectBanner: []
  },
  {
    name: "watch, plain user latch",
    state: watching(),
    control: dto(null, "paused"),
    stopsInput: (s) => blocked(s),
    handBack: () => true,
    unpause: (_s, a) => a.dock.includes("clear_latch"),
    expectDock: ["stop", "clear_latch"],
    expectPanel: ["open_screen"],
    expectBanner: []
  },
  {
    name: "acquiring",
    state: applyTakeoverAccepted(watching(), { takeover_id: "to-1", control_epoch: 5, state: "acquiring" }),
    control: dto(tk({ state: "acquiring" })),
    stopsInput: (s, a) => blocked(s) && hasStop(a),
    handBack: (_s, a) => a.panel.includes("bitirdim"),
    unpause: (_s, a) => hasStop(a),
    expectDock: ["stop"],
    expectPanel: ["bitirdim"],
    expectBanner: []
  },
  {
    name: "active, ours",
    state: owning(),
    control: dto(tk()),
    stopsInput: (_s, a) => a.dock.includes("bitirdim") && hasStop(a),
    handBack: (_s, a) => a.dock.includes("bitirdim") && a.panel.includes("bitirdim"),
    unpause: (_s, a) => a.dock.includes("bitirdim"),
    expectDock: ["stop", "bitirdim"],
    expectPanel: ["bitirdim"],
    expectBanner: []
  },
  {
    name: "release in flight / failed",
    state: pendingFailed(),
    control: dto(tk()),
    stopsInput: (s) => blocked(s),
    handBack: (_s, a) => a.dock.includes("retry_bitirdim") && a.panel.includes("retry_bitirdim"),
    unpause: (_s, a) => a.dock.includes("retry_bitirdim") && hasStop(a),
    expectDock: ["stop", "retry_bitirdim"],
    expectPanel: ["retry_bitirdim"],
    expectBanner: []
  },
  {
    name: "release interrupted (expired during pending)",
    state: applyControlStateDto(pendingFailed(), dto(tk({ state: "paused", reason: "expired" }), "paused")),
    control: dto(tk({ state: "paused", reason: "expired" }), "paused"),
    stopsInput: (s) => blocked(s),
    handBack: (s) => s.lastError?.code === "release_interrupted", // told it is gone
    unpause: (_s, a) => a.banner.includes("clear_pause") && a.dock.includes("clear_pause"),
    expectDock: ["stop", "clear_pause"],
    expectPanel: [],
    expectBanner: ["clear_pause", "open_screen"]
  },
  {
    name: "paused, ours, disconnected",
    state: pausedOwn("disconnected"),
    control: dto(tk({ state: "paused", reason: "disconnected" }), "paused"),
    stopsInput: (s) => blocked(s),
    handBack: (_s, a) => a.dock.includes("reacquire"), // reacquire, then Bitirdim
    unpause: (_s, a) => a.dock.includes("clear_pause") && a.banner.includes("clear_pause"),
    expectDock: ["stop", "reacquire", "clear_pause"],
    expectPanel: ["reacquire"],
    expectBanner: ["clear_pause", "open_screen"]
  },
  {
    name: "paused, ours, local_override / restart",
    state: pausedOwn("restart"),
    control: dto(tk({ state: "paused", reason: "restart" }), "paused"),
    stopsInput: (s) => blocked(s),
    handBack: () => true, // not applicable: copy says clear the pause
    unpause: (_s, a) => a.dock.includes("clear_pause") && a.banner.includes("clear_pause"),
    expectDock: ["stop", "clear_pause"],
    expectPanel: [],
    expectBanner: ["clear_pause", "open_screen"]
  },
  {
    name: "paused, ours, only locally mirrored (daemon still active)",
    state: applyStreamDisconnected(owning()),
    control: dto(tk()),
    stopsInput: (s) => blocked(s),
    handBack: (_s, a) => a.dock.includes("reacquire"),
    unpause: (_s, a) => a.banner.includes("clear_pause"),
    expectDock: ["stop", "reacquire", "clear_pause"],
    expectPanel: ["reacquire"],
    expectBanner: ["clear_pause", "open_screen"]
  },
  {
    name: "foreign active",
    state: applyControlStateDto(watching(), dto(tk({ id: NIL, session_id: NIL, owner: "peer:phone" }))),
    control: dto(tk({ id: NIL, session_id: NIL, owner: "peer:phone" })),
    stopsInput: (s) => blocked(s),
    handBack: () => true, // theirs
    unpause: (_s, a) => hasStop(a), // local Stop overrides, next row takes over
    expectDock: ["stop"],
    expectPanel: ["open_screen"],
    expectBanner: []
  },
  {
    name: "foreign paused (redacted id), local client",
    state: applyControlStateDto(watching(), foreign()),
    control: foreign(),
    stopsInput: (s) => blocked(s),
    handBack: () => true, // theirs
    unpause: (_s, a) => a.dock.includes("clear_foreign_pause") && a.banner.includes("clear_foreign_pause"),
    expectDock: ["stop", "clear_foreign_pause"],
    expectPanel: ["open_screen"],
    expectBanner: ["clear_foreign_pause", "open_screen"]
  },
  {
    name: "disconnected while watching",
    state: applyStreamDisconnected(watching()),
    control: dto(null),
    stopsInput: (s) => blocked(s),
    handBack: () => true,
    unpause: () => true, // automatic reconnect, nothing paused
    expectDock: ["stop"],
    expectPanel: ["open_screen"],
    expectBanner: []
  }
];

for (const row of rows) {
  test(`state table: ${row.name}`, () => {
    const a = visibleActions(row.state, row.control, true);
    assert.deepEqual(a.dock, row.expectDock, "dock");
    assert.deepEqual(a.panel, row.expectPanel, "panel");
    assert.deepEqual(a.banner, row.expectBanner, "banner");
    assert.ok(row.stopsInput(row.state, a), "(a) a way to stop input");
    assert.ok(row.handBack(row.state, a), "(b) hand back, or told it is gone");
    assert.ok(row.unpause(row.state, a), "(c) a way to unpause");
  });
}

test("state table: a paired (non-local) client never sees the foreign clear action", () => {
  const st = applyControlStateDto(watching(), foreign());
  const a = visibleActions(st, foreign(), false);
  assert.ok(!a.dock.includes("clear_foreign_pause"));
  assert.deepEqual(a.banner, []);
  assert.equal(isLocalBaseUrl("http://127.0.0.1:7788"), true);
  assert.equal(isLocalBaseUrl("http://localhost:1"), true);
  assert.equal(isLocalBaseUrl("mock://praxi"), true);
  assert.equal(isLocalBaseUrl("https://relay.example.net/x"), false);
});

// ---- foreign clear: verified against owner, target and reason -------------

const deps = (fresh: ControlStateDto | Error) => {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      getControlState: async () => {
        calls.push("get");
        if (fresh instanceof Error) throw fresh;
        return fresh;
      },
      recover: async () => {
        calls.push("recover");
        return dto(null);
      },
      releaseLatch: async () => {
        calls.push("release");
        return dto(null);
      }
    }
  };
};

test("foreign clear re-reads and aborts when owner, target or reason changed", async () => {
  const expected = foreignPausedTakeover(applyControlStateDto(watching(), foreign()), foreign());
  assert.ok(expected);
  const target = { kind: "foreign" as const, expected };

  const same = deps(foreign());
  assert.equal((await runClearPause(same.deps, target)).kind, "cleared");
  assert.deepEqual(same.calls, ["get", "recover"]);

  for (const changed of [
    dto(tk({ id: NIL, owner: "peer:other", state: "paused", reason: "local_override" }), "paused"),
    dto(tk({ id: NIL, owner: "peer:phone", state: "paused", reason: "local_override", target_id: "t-9" }), "paused"),
    foreign("disconnected"),
    dto(tk({ id: NIL, owner: "peer:phone", state: "active" })),
    dto(null)
  ]) {
    const d = deps(changed);
    const out = await runClearPause(d.deps, target);
    assert.equal(out.kind, "aborted");
    assert.deepEqual(d.calls, ["get"], "never posted");
  }
});

// ---- latch-only and null target --------------------------------------------

test("latch-only clear re-reads, aborts if a takeover appeared, and uses the ordinary release", async () => {
  const appeared = deps(dto(tk({ id: NIL, owner: "peer:p" })));
  assert.equal((await runClearPause(appeared.deps, { kind: "latch" })).kind, "aborted");
  assert.deepEqual(appeared.calls, ["get"]);

  const plain = deps(dto(null, "paused"));
  assert.equal((await runClearPause(plain.deps, { kind: "latch" })).kind, "cleared");
  assert.deepEqual(plain.calls, ["get", "release"], "release, not recover");

  // the unreadable-latch case: release refuses, recover is the fallback
  const calls: string[] = [];
  const out = await runClearPause(
    {
      getControlState: async () => dto(null, "paused"),
      releaseLatch: async () => {
        calls.push("release");
        throw new Error("409");
      },
      recover: async () => {
        calls.push("recover");
        return dto(null);
      }
    },
    { kind: "latch" }
  );
  assert.equal(out.kind, "cleared");
  assert.deepEqual(calls, ["release", "recover"]);
});

test("nothing shown at click time aborts without posting", async () => {
  const d = deps(dto(null));
  const out = await runClearPause(d.deps, null);
  assert.equal(out.kind, "aborted");
  assert.deepEqual(d.calls, []);
});

// ---- ordering, single poller, bounded lease, lastError ---------------------

test("an older snapshot request never overwrites a newer state", () => {
  const seq = createSnapshotSequencer();
  const pollTicket = seq.issue(); // GET sent before the POST
  seq.markFresh(); // Clear pause / Bitirdim response applied
  assert.equal(seq.accept(pollTicket), false, "the late poll is dropped");
  const later = seq.issue();
  assert.equal(seq.accept(later), true);
  // two polls resolving out of order
  const a = seq.issue();
  const b = seq.issue();
  assert.equal(seq.accept(b), true);
  assert.equal(seq.accept(a), false);
});

test("a pending release stops renewing the lease after the bound (it lapses into the banner state)", () => {
  const releasing = applyControlStateDto(
    applyReleaseStarted(owning(), "req-1", null, 1_000),
    dto(tk())
  );
  assert.deepEqual(buildSessionHeartbeat(releasing, 1_000 + 5_000), {
    takeover_id: "to-1",
    control_epoch: 5
  });
  assert.deepEqual(buildSessionHeartbeat(releasing, 1_000 + RELEASE_LEASE_MAX_MS + 1), {});
});

test("a successful Clear pause clears a stale error (state level)", () => {
  const withError = applyReleaseFailed(
    applyReleaseStarted(owning(), "req-1", null),
    "release_failed",
    "x"
  );
  const interrupted = applyControlStateDto(withError, dto(tk({ state: "paused", reason: "expired" }), "paused"));
  assert.equal(interrupted.lastError?.code, "release_interrupted");
  const cleared = { ...applyControlStateDto(interrupted, dto(null)), lastError: null };
  assert.equal(cleared.lastError, null);
  assert.equal(applyTakeoverStarted(cleared, "r").lastError, null);
});

// ---- wiring ------------------------------------------------------------------

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("wiring: one poller under Tauri, ordered snapshots, labelled foreign clear, lastError reset", () => {
  const ctx = read("../state/LiveViewContext.tsx");
  assert.match(ctx, /if \(registry\.current\(\)\) \{\s*return;/);
  assert.match(ctx, /ingestControlSnapshot\(dto, ticket\)/);
  assert.match(ctx, /sequencer\.markFresh\(\)/);
  assert.match(ctx, /lastError: null\s*\}\)\);/);
  assert.match(ctx, /releaseLatch: \(\) => client\.releaseControl\(\)/);
  const host = read("../state/ControlBridgeHost.tsx");
  assert.match(host, /issueSnapshotTicket/);
  const bridge = read("../state/controlBridge.ts");
  assert.match(bridge, /issueSnapshotTicket\?\.\(\)/);
  const banner = read("../components/PausedControlBanner.tsx");
  assert.match(banner, /clearForeignPause/);
  assert.match(banner, /visibleActions\(/);
  const viewer = read("../views/LiveViewer.tsx");
  assert.match(viewer, /clearPause\("foreign"\)/);
  assert.match(viewer, /clearPause\("latch"\)/);
  assert.match(viewer, /visibleActions\(/);
  assert.match(read("../components/BotComputerBlock.tsx"), /visibleActions\(/);
  for (const l of ["en", "tr"]) {
    const j = JSON.parse(read(`../i18n/locales/${l}.json`));
    assert.match(j.liveView.clearForeignPause, /\{\{owner\}\}/, l);
  }
});

// ---- follow-ups from the final review ---------------------------------------

import { admitSnapshot } from "./snapshotOrder.ts";

test("latch fallback: a release refusal because a peer just took control aborts instead of recovering", async () => {
  const calls: string[] = [];
  let reads = 0;
  const out = await runClearPause(
    {
      getControlState: async () => {
        reads += 1;
        // 1st read: plain latch; 2nd read (after the refusal): a peer holds control
        return reads === 1 ? dto(null, "paused") : dto(tk({ id: NIL, owner: "peer:p" }));
      },
      releaseLatch: async () => {
        calls.push("release");
        throw new Error("409 owned takeover");
      },
      recover: async () => {
        calls.push("recover");
        return dto(null);
      }
    },
    { kind: "latch" }
  );
  assert.equal(out.kind, "aborted");
  assert.deepEqual(calls, ["release"], "recover never interrupts the peer");

  // still no takeover and still paused: the unreadable-latch fallback applies
  const calls2: string[] = [];
  const ok = await runClearPause(
    {
      getControlState: async () => dto(null, "paused"),
      releaseLatch: async () => {
        calls2.push("release");
        throw new Error("409");
      },
      recover: async () => {
        calls2.push("recover");
        return dto(null);
      }
    },
    { kind: "latch" }
  );
  assert.equal(ok.kind, "cleared");
  assert.deepEqual(calls2, ["release", "recover"]);

  // latch no longer paused after the refusal: nothing to recover
  let n = 0;
  const gone = await runClearPause(
    {
      getControlState: async () => (++n === 1 ? dto(null, "paused") : dto(null)),
      releaseLatch: async () => {
        throw new Error("409");
      },
      recover: async () => dto(null)
    },
    { kind: "latch" }
  );
  assert.equal(gone.kind, "aborted");
});

test("an untagged snapshot (action response) invalidates older in-flight GETs", () => {
  const seq = createSnapshotSequencer();
  const inFlight = seq.issue(); // refreshTargets GET
  assert.equal(admitSnapshot(seq, undefined), true, "native Pause / Stop / release response");
  assert.equal(admitSnapshot(seq, inFlight), false, "the older GET no longer overwrites it");
  assert.equal(admitSnapshot(seq, seq.issue()), true);
});

test("the dock renders its buttons from visibleActions (so the state table constrains it)", () => {
  const viewer = read("../views/LiveViewer.tsx");
  assert.match(viewer, /actions\.includes\("bitirdim"\) \|\| actions\.includes\("retry_bitirdim"\)/);
  assert.match(viewer, /actions\.includes\("retry_bitirdim"\)/);
  assert.match(viewer, /recoveryPrompt && actions\.includes\("clear_pause"\)/);
  assert.match(viewer, /actions\.includes\("reacquire"\)/);
  assert.match(viewer, /actions\.includes\("stop"\)/);
  assert.doesNotMatch(viewer, /ownsActive \|\| isReleasing/);
  assert.match(read("../state/LiveViewContext.tsx"), /admitSnapshot\(sequencer, ticket\)/);
});

test("a loopback proxy to a paired host is a peer connection, not the local user", () => {
  const url = "http://127.0.0.1:54321";
  assert.equal(isLocalBaseUrl(url), true);
  const unmark = markRemoteBaseUrl(`${url}/`);
  assert.equal(isLocalBaseUrl(url), false);
  assert.equal(isLocalBaseUrl("http://127.0.0.1:54322"), true);
  unmark();
  assert.equal(isLocalBaseUrl(url), true);
});

test("a preview never reports the human as driving: only an accepted take-over is live", () => {
  // The right panel's card, in every state a passive look can reach.
  let st = watching();
  for (const step of [
    (s: LiveViewControllerState) => s,
    (s: LiveViewControllerState) => applyFrameRendered(s, frame, 2000),
    (s: LiveViewControllerState) => applyStatusRecord(s, { ...statusActive, input_allowed: false }, 2100)
  ]) {
    st = step(st);
    assert.equal(sessionProfile(st), "watch");
    assert.equal(isActivelyOwningTakeover(st), false);
    assert.equal(buildSessionHeartbeat(st).takeover_id, undefined, "no take-over lease is renewed");
  }
  // The explicit take-over is the only thing that makes it live.
  assert.equal(sessionProfile(owning()), "live");
});
