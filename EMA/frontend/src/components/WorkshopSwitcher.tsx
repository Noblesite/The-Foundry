import React from "react";
import { Workshop } from "../domain/foundry";

interface WorkshopSwitcherProps {
  activeWorkshopId: string;
  workshops: Workshop[];
  onCreateWorkshop: () => void;
  onDeleteWorkshop: (workshop: Workshop) => void;
  onSelectWorkshop: (workshop: Workshop) => void;
}

const WorkshopSwitcher: React.FC<WorkshopSwitcherProps> = ({
  activeWorkshopId,
  workshops,
  onCreateWorkshop,
  onDeleteWorkshop,
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
      {workshops.map((workshop) => {
        const isActive = activeWorkshopId === workshop.id;
        return (
          <div
            key={workshop.id}
            className={`workshop-list-item ${isActive ? "is-active" : ""}`}
            role="group"
          >
            <button
              className="workshop-list-select"
              onClick={() => onSelectWorkshop(workshop)}
              type="button"
            >
              <span>{workshop.name}</span>
              <small>{workshop.voiceTarget} / {workshop.status}</small>
            </button>
            <button
              aria-label={`Delete Workshop ${workshop.name}`}
              className="workshop-delete-button"
              onClick={() => onDeleteWorkshop(workshop)}
              type="button"
            >
              <i className="fas fa-trash-can" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  </section>
);

export default WorkshopSwitcher;
