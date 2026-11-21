import { PauseCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "ui";
import { foreignPausedTakeover, visibleActions } from "../lib/liveViewState";
import { requestStop } from "../state/appStop";
import { useLiveView } from "../state/LiveViewContext";
import styles from "./PausedControlBanner.module.css";

/**
 * Stays on the main screen while the daemon holds a paused takeover, whether or
 * not the viewer or the right panel is open and whatever the native run state
 * says (Stop sets the native mode to idle but never ends the daemon pause).
 * Our own paused takeover offers "Clear pause"; another actor's paused takeover
 * (id redacted) offers a separately labelled "Clear <owner>'s pause" to the
 * local user only. Both verify against fresh state before posting
 * `POST /v1/control/recover`; reacquiring needs the screen (Open screen).
 */
export function PausedControlBanner() {
  const { t } = useTranslation();
  const { state, controlState, clearPause, pauseClearing, openViewer, canClearForeignPause } =
    useLiveView();
  const actions = visibleActions(state, controlState, canClearForeignPause).banner;
  // Optimistic: gone the moment the user clicks; a failure brings it back with a toast.
  if (actions.length === 0 || pauseClearing) {
    return null;
  }
  const foreign = foreignPausedTakeover(state, controlState);
  return (
    <div className={styles.wrap}>
      <div className={styles.banner} role="status" data-testid="paused-control-banner">
        <PauseCircle aria-hidden="true" />
        <span className={styles.text}>
          <strong>{t("liveView.pausedBanner.title")}</strong>
          <span>{t("liveView.pausedBanner.body")}</span>
        </span>
        <span className={styles.actions}>
          {actions.includes("clear_pause") ? (
            <Button
              variant="primary"
              size="sm"
              data-testid="paused-banner-clear"
              onClick={() => void clearPause("own")}
            >
              {t("liveView.clearPauseAction")}
            </Button>
          ) : null}
          {actions.includes("clear_foreign_pause") && foreign ? (
            <Button
              variant="primary"
              size="sm"
              data-testid="paused-banner-clear-foreign"
              onClick={() => void clearPause("foreign")}
            >
              {t("liveView.clearForeignPause", { owner: foreign.owner })}
            </Button>
          ) : null}
          {actions.includes("open_screen") ? (
            <Button
              variant="secondary"
              size="sm"
              data-testid="paused-banner-open"
              onClick={() => openViewer()}
            >
              {t("liveView.openScreen")}
            </Button>
          ) : null}
          {/* A run parked behind the pause shows as running: Stop must always be one click away. */}
          <Button
            variant="danger"
            size="sm"
            data-testid="paused-banner-stop"
            onClick={() => requestStop("banner")}
          >
            {t("liveView.emergencyStop")}
          </Button>
        </span>
      </div>
    </div>
  );
}
