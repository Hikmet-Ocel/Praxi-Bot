import { ChevronDown, ChevronRight, Globe } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { brandIcon } from "../lib/brandIcons";
import { formatClock, formatStamp, formatStepDuration, type MessageTimes } from "../lib/messageTime";
import { type Chain, chainSeconds, type ChainStep } from "../lib/thinkingChain";
import { isInFlight, isOrphanStep, isSlowStep } from "../lib/stepStuck";
import { describeTool, stepPhase } from "../lib/toolLabels";
import type { ToolItem } from "../state/timeline";
import { ToolBody } from "./ChatCards";
import { Markdown } from "./Markdown";
import { StepIcon } from "./StepIcon";
import styles from "./ThinkingChain.module.css";

/**
 * Plural keys (`<name>_one` / `<name>_other`) are looked up through a
 * variable so check:i18n, which only sees literal keys, does not flag them.
 */
function counted(t: TFunction, name: string, count: number): string {
  return t(`chat.${name}`, { count });
}

/** "12 seconds" / "1 minute 5 seconds". */
export function formatSpan(t: TFunction, seconds: number): string {
  if (seconds < 60) {
    return counted(t, "duration.seconds", seconds);
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const mins = counted(t, "duration.minutes", m);
  return s > 0 ? `${mins} ${counted(t, "duration.seconds", s)}` : mins;
}

const brandName = (name: string): string | null => {
  const b = brandIcon(name);
  return b.known ? b.name : null;
};

/** Daemon-measured run time, else request to completion. */
function stepMs(tool: ToolItem): number | undefined {
  if (tool.durationMs !== undefined) {
    return tool.durationMs;
  }
  return tool.completedMs !== undefined ? tool.completedMs - tool.requestedMs : undefined;
}

function ToolStep({ tool, times, live }: { tool: ToolItem; times: MessageTimes; live: boolean }) {
  const { t, i18n } = useTranslation();
  const ms = stepMs(tool);
  const clock = times === "off" ? null : formatClock(tool.requestedMs, i18n.language, true);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const label = describeTool(tool.name, tool.input, brandName);
  // A step whose end never arrived in a chain that is over is shown as not finished, never as running.
  const orphan = isOrphanStep(tool.status, live);
  const active = isInFlight(tool.status) && !orphan;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [active]);
  const slow = active && isSlowStep(tool, now);
  const bad =
    orphan ||
    tool.status === "error" ||
    tool.status === "denied" ||
    tool.status === "expired";
  const phase = orphan ? "failed" : stepPhase(tool.status);
  const text = t(`${label.key}.${phase}`, label.values);
  return (
    <li
      className={[styles.step, bad ? styles.stepBad : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid="tool-card"
      data-status={tool.status}
    >
      <StepIcon icon={label.icon} brand={label.brand} size={17} />
      <div className={styles.stepMain}>
        <div className={styles.stepLine}>
          <b className={active ? styles.shim : styles.stepLabel}>{text}</b>
          {bad ? (
            <span className={styles.stepStatus}>
              {t(`chat.tool.status.${orphan ? "expired" : tool.status}`)}
            </span>
          ) : null}
          {slow ? (
            <span className={styles.stepStatus} data-testid="step-slow">
              {t("chat.chain.slow")}
            </span>
          ) : null}
          <button
            type="button"
            className={styles.more}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${t("chat.chain.details")}: ${text}`}
            title={t("chat.chain.details")}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronRight className={open ? styles.moreOpen : undefined} />
          </button>
          {clock ? (
            <span
              className={styles.stepTime}
              title={formatStamp(tool.requestedMs, i18n.language)}
              data-testid="step-time"
            >
              {clock}
              {ms !== undefined && !active
                ? ` · ${formatStepDuration(ms, i18n.language, {
                    s: t("chat.duration.shortSeconds"),
                    m: t("chat.duration.shortMinutes")
                  })}`
                : ""}
            </span>
          ) : null}
        </div>
        {label.chips.length > 0 ? (
          <div className={styles.chips}>
            {label.chips.map((c, i) => (
              <span key={i} className={styles.chip}>
                {c.icon === "globe" ? <Globe aria-hidden="true" /> : null}
                {c.text}
              </span>
            ))}
          </div>
        ) : null}
        {open ? (
          <div id={panelId} className={styles.detail}>
            <span className={styles.rawName}>{tool.name}</span>
            <ToolBody tool={tool} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Step({ step, times, live }: { step: ChainStep; times: MessageTimes; live: boolean }) {
  return step.kind === "thought" ? (
    <li className={styles.thought}>
      <Markdown text={step.text} />
    </li>
  ) : (
    <ToolStep tool={step.tool} times={times} live={live} />
  );
}

/**
 * Tool calls and short thoughts folded into one line ("Thought for 12
 * seconds"); opening it lists the steps in plain words with source chips.
 * While the run is working it is open and the title shimmers.
 */
export function ThinkingChain({
  chain,
  avatar,
  times = "minutes"
}: {
  chain: Chain;
  /** Settings, General: step times off / on. */
  times?: MessageTimes;
  /** The bot's character, shown at the start of the line. */
  avatar?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const listId = useId();
  const open = userOpen ?? chain.live;
  const title = chain.live
    ? t("chat.chain.working")
    : t("chat.chain.thought", {
        duration: formatSpan(t, chainSeconds(chain))
      });
  const span =
    times === "off"
      ? undefined
      : chain.live
        ? t("chat.chain.started", { start: formatStamp(chain.spanStartMs, i18n.language) })
        : t("chat.chain.startedFinished", {
            start: formatStamp(chain.spanStartMs, i18n.language),
            end: formatStamp(chain.endMs, i18n.language)
          });
  return (
    <div
      className={styles.chain}
      data-testid="thinking-chain"
      data-live={chain.live ? "true" : undefined}
    >
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        aria-controls={listId}
        title={span}
        onClick={() => setUserOpen(!open)}
      >
        {avatar}
        <span className={chain.live ? styles.shim : styles.title}>{title}</span>
        {chain.problems > 0 ? (
          <span className={styles.problems}>
            {counted(t, "chain.problems", chain.problems)}
          </span>
        ) : null}
        <ChevronDown
          className={[styles.chev, open ? styles.chevOpen : ""]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <ol id={listId} className={styles.steps}>
          {chain.steps.map((s) => (
            <Step key={s.key} step={s} times={times} live={chain.live} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}
