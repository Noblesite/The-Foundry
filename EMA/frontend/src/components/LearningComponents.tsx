import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AcademyAction } from "../domain/foundry";

interface ConceptTooltipProps {
  label: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

interface LearningCardProps {
  title: string;
  body: string;
  academyAction?: AcademyAction;
  actionLabel?: string;
  onAction?: () => void;
}

interface AcademyActionTooltipProps {
  action?: AcademyAction;
  label?: string;
}

interface LearningActionProps {
  action?: AcademyAction;
  className?: string;
  fallbackLabel?: string;
  icon?: string;
  onOpen: (action?: AcademyAction) => void;
}

interface TokenPreviewProps {
  text: string;
}

type TooltipPlacement = "above" | "below";

interface TooltipPosition {
  left: number;
  top: number;
  width: number;
  placement: TooltipPlacement;
}

const TOOLTIP_MARGIN = 16;
const TOOLTIP_MAX_WIDTH = 320;
const TOOLTIP_MIN_WIDTH = 240;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const getTooltipPosition = (trigger: HTMLElement): TooltipPosition => {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const availableWidth = Math.max(0, viewportWidth - TOOLTIP_MARGIN * 2);
  const width = Math.min(TOOLTIP_MAX_WIDTH, Math.max(TOOLTIP_MIN_WIDTH, availableWidth));
  const left = clamp(rect.left, TOOLTIP_MARGIN, Math.max(TOOLTIP_MARGIN, viewportWidth - width - TOOLTIP_MARGIN));
  const placement: TooltipPlacement = rect.top > 190 ? "above" : "below";

  return {
    left,
    top: placement === "above" ? rect.top - 12 : rect.bottom + 12,
    width,
    placement,
  };
};

export const ConceptTooltip: React.FC<ConceptTooltipProps> = ({ label, title, children }) => {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) {
      return;
    }
    setPosition(getTooltipPosition(triggerRef.current));
  }, []);

  const openTooltip = () => {
    updatePosition();
    setIsOpen(true);
  };

  const closeTooltip = () => {
    setIsOpen(false);
  };

  const stopLabelForwarding = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const clickTooltip = (event: React.MouseEvent<HTMLSpanElement>) => {
    stopLabelForwarding(event);
    openTooltip();
  };

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  return (
    <>
      <span
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-label={typeof label === "string" ? undefined : title}
        className="concept-tooltip"
        onBlur={closeTooltip}
        onClick={clickTooltip}
        onFocus={openTooltip}
        onMouseDown={stopLabelForwarding}
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltip}
        ref={triggerRef}
        tabIndex={0}
      >
        {label}
      </span>
      {isOpen && position && createPortal(
        <span
          className={`concept-tooltip-card tooltip-floating-card tooltip-floating-card-${position.placement}`}
          id={tooltipId}
          role="tooltip"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
          }}
        >
          <strong>{title}</strong>
          <span>{children}</span>
        </span>,
        document.body
      )}
    </>
  );
};

export const AcademyActionTooltip: React.FC<AcademyActionTooltipProps> = ({
  action,
  label,
}) => {
  if (!action) {
    return null;
  }

  return (
    <ConceptTooltip label={label || action.tooltipTitle} title={action.tooltipTitle}>
      {action.tooltipBody}
    </ConceptTooltip>
  );
};

export const LearningAction: React.FC<LearningActionProps> = ({
  action,
  className = "button-ghost",
  fallbackLabel,
  icon = "fa-arrow-right",
  onOpen,
}) => {
  const label = action?.label || fallbackLabel;
  if (!label) {
    return null;
  }

  return (
    <button
      className={className}
      onClick={() => onOpen(action)}
      title={action?.tooltipBody}
      type="button"
    >
      {label}
      {icon && <i className={`fas ${icon}`} aria-hidden="true" />}
    </button>
  );
};

export const LearningCard: React.FC<LearningCardProps> = ({
  title,
  body,
  academyAction,
  actionLabel,
  onAction,
}) => (
  <article className="learning-card panel-glass">
    <div className="learning-card-icon">
      <i className="fas fa-atom" aria-hidden="true" />
    </div>
    <div>
      <p className="section-eyebrow">Academy</p>
      <h3>{title}</h3>
      <p>{body}</p>
      <LearningAction
        action={academyAction}
        fallbackLabel={actionLabel}
        onOpen={() => onAction?.()}
      />
    </div>
  </article>
);

export const ProcessExplainer: React.FC = () => (
  <div className="process-explainer panel-glass" aria-label="Foundry build process">
    {["Materials", "Assembly Line", "Forge", "Artifact"].map((step, index) => (
      <React.Fragment key={step}>
        <div className="process-step">
          <span>{index + 1}</span>
          <strong>{step}</strong>
        </div>
        {index < 3 && <i className="fas fa-chevron-right" aria-hidden="true" />}
      </React.Fragment>
    ))}
  </div>
);

export const LayerVisualizer: React.FC = () => (
  <article className="layer-visualizer panel-glass">
    <div className="panel-heading compact">
      <div>
        <p className="section-eyebrow">Learn as you build</p>
        <h2>LoRA Layer</h2>
      </div>
      <i className="fas fa-circle-info" aria-hidden="true" />
    </div>
    <div className="layer-stack" aria-hidden="true">
      <div className="layer-node">A</div>
      <div className="layer-link" />
      <div className="layer-node">B</div>
    </div>
    <p>
      Adapter layers learn compact updates while the base model stays mostly
      frozen.
    </p>
  </article>
);

export const TokenPreview: React.FC<TokenPreviewProps> = ({ text }) => {
  const tokens = text.split(" ");

  return (
    <article className="token-preview panel-glass">
      <p className="section-eyebrow">Token preview</p>
      <h2>Text becomes tokens</h2>
      <div className="token-list">
        {tokens.map((token, index) => (
          <span key={`${token}-${index}`}>{token}</span>
        ))}
      </div>
    </article>
  );
};

export const TrainingMetricExplainer: React.FC = () => (
  <LearningCard
    title="Training loss is a signal, not a scoreboard"
    body="Loss can decrease while the model still learns weak habits. Compare validation answers and examples before trusting a Forge."
  />
);
