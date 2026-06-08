import React from "react";
import { Workshop } from "../domain/foundry";

interface WorkshopSwitcherProps {
  activeWorkshopId: string;
  workshops: Workshop[];
  onCreateWorkshop: () => void;
  onSelectWorkshop: (workshop: Workshop) => void;
}

const WorkshopSwitcher: React.FC<WorkshopSwitcherProps> = ({
  activeWorkshopId,
  workshops,
  onCreateWorkshop,
  onSelectWorkshop,
}) => (
  <section className="workshop-switcher panel-glass" aria-label="Saved Workshops">
    <div className="workshop-switcher-heading">
      <div>
        <p className="section-eyebrow">Saved</p>
        <h2>Workshops</h2>
      </div>
      <button className="icon-button" onClick={onCreateWorkshop} aria-label="Create Workshop">
        <i className="fas fa-plus" aria-hidden="true" />
      </button>
    </div>

    <div className="workshop-list">
      {workshops.map((workshop) => (
        <button
          key={workshop.id}
          className={`workshop-list-item ${activeWorkshopId === workshop.id ? "is-active" : ""}`}
          onClick={() => onSelectWorkshop(workshop)}
        >
          <span>{workshop.name}</span>
          <small>{workshop.voiceTarget} / {workshop.status}</small>
        </button>
      ))}
    </div>
  </section>
);

export default WorkshopSwitcher;
