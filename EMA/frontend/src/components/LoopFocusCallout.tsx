import React, { useEffect, useRef } from "react";
import { FoundryLoopFocus, NavigationSection } from "../domain/foundry";

interface LoopFocusCalloutProps {
  focus?: FoundryLoopFocus | null;
  nextAction?: string;
  section: NavigationSection;
}

const LoopFocusCallout: React.FC<LoopFocusCalloutProps> = ({ focus, nextAction, section }) => {
  const calloutRef = useRef<HTMLElement | null>(null);
  const isActiveFocus = Boolean(focus && focus.section === section);

  useEffect(() => {
    if (!isActiveFocus) {
      return;
    }
    calloutRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus?.requestedAt, isActiveFocus]);

  if (!isActiveFocus || !focus) {
    return null;
  }

  return (
    <article
      aria-label={`Dashboard focus: ${focus.stepLabel}`}
      className="loop-focus-callout panel-glass"
      ref={calloutRef}
    >
      <div className="loop-focus-icon" aria-hidden="true">
        <i className="fas fa-location-crosshairs" />
      </div>
      <div>
        <p className="panel-kicker">Dashboard focus</p>
        <h2>{focus.title}</h2>
        <p>{focus.detail}</p>
        <div className="material-meta">
          <span>{focus.stepLabel}</span>
          <span>{focus.targetLabel}</span>
          <span>{focus.actionLabel}</span>
        </div>
        {nextAction && (
          <div className="loop-focus-next-action">
            <span>Next required action</span>
            <strong>{nextAction}</strong>
          </div>
        )}
      </div>
    </article>
  );
};

export default LoopFocusCallout;
