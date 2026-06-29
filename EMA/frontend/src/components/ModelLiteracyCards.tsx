import React from "react";
import { ModelLiteracyProfile } from "../domain/modelLiteracy";

interface ModelLiteracyCardsProps {
  profile: ModelLiteracyProfile;
  compact?: boolean;
}

const ModelLiteracyCards: React.FC<ModelLiteracyCardsProps> = ({ profile, compact = false }) => (
  <section
    aria-label={`Model literacy for ${profile.modelId}`}
    className={`model-literacy-panel ${compact ? "is-compact" : ""}`}
  >
    <div className="model-literacy-heading">
      <div>
        <p className="panel-kicker">Model literacy</p>
        <h3>Understand {profile.label}</h3>
      </div>
      <span className="status-badge">{profile.family}</span>
    </div>
    <div className="model-literacy-grid">
      {profile.cards.map((card) => (
        <article className="model-literacy-card" key={card.id}>
          <div className="model-literacy-card-title">
            <span aria-hidden="true">
              <i className={`fas ${card.icon}`} />
            </span>
            <h4>{card.title}</h4>
          </div>
          <p>{card.body}</p>
          <ul>
            {card.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  </section>
);

export default ModelLiteracyCards;
