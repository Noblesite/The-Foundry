import React from "react";

interface ConceptTooltipProps {
  label: string;
  title: string;
  children: React.ReactNode;
}

interface LearningCardProps {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface TokenPreviewProps {
  text: string;
}

export const ConceptTooltip: React.FC<ConceptTooltipProps> = ({ label, title, children }) => (
  <span className="concept-tooltip" tabIndex={0}>
    {label}
    <span className="concept-tooltip-card" role="tooltip">
      <strong>{title}</strong>
      <span>{children}</span>
    </span>
  </span>
);

export const LearningCard: React.FC<LearningCardProps> = ({
  title,
  body,
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
      {actionLabel && (
        <button className="button-ghost" onClick={onAction}>
          {actionLabel}
          <i className="fas fa-arrow-right" aria-hidden="true" />
        </button>
      )}
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
