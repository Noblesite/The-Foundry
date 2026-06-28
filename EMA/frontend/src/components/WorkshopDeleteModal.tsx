import React, { useEffect, useState } from "react";
import { Workshop } from "../domain/foundry";

interface WorkshopDeleteModalProps {
  error?: string | null;
  isDeleting: boolean;
  isOpen: boolean;
  remainingWorkshopCount: number;
  workshop: Workshop | null;
  onCancel: () => void;
  onConfirm: (confirmationName: string) => void;
}

const WorkshopDeleteModal: React.FC<WorkshopDeleteModalProps> = ({
  error,
  isDeleting,
  isOpen,
  remainingWorkshopCount,
  workshop,
  onCancel,
  onConfirm,
}) => {
  const [confirmationName, setConfirmationName] = useState("");

  useEffect(() => {
    if (isOpen) {
      setConfirmationName("");
    }
  }, [isOpen, workshop?.id]);

  if (!isOpen || !workshop) {
    return null;
  }

  const isLastWorkshop = remainingWorkshopCount <= 1;
  const isConfirmed = confirmationName === workshop.name;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="workshop-delete-description"
        aria-labelledby="workshop-delete-title"
        aria-modal="true"
        className="workshop-modal workshop-delete-modal panel-glass"
        role="dialog"
      >
        <div className="modal-heading">
          <p className="section-eyebrow">Workshop Cleanup</p>
          <h2 id="workshop-delete-title">Delete {workshop.name}</h2>
          <button
            aria-label="Close delete Workshop dialog"
            className="icon-button"
            disabled={isDeleting}
            onClick={onCancel}
            type="button"
          >
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <p id="workshop-delete-description" className="modal-support">
          This removes the Workshop plus its Materials, Assembly Line runs, QA pairs, Forges,
          Artifacts, Constructs, Trials, and Foundry-managed runtime files.
        </p>

        <div className="delete-warning">
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          <span>
            Type <strong>{workshop.name}</strong> to confirm this cleanup target.
          </span>
        </div>

        {isLastWorkshop && (
          <p className="form-error">
            Create another Workshop before deleting the last one.
          </p>
        )}

        <label className="field-label" htmlFor="delete-workshop-confirmation">
          Confirmation
        </label>
        <input
          autoComplete="off"
          className="foundry-input"
          disabled={isDeleting || isLastWorkshop}
          id="delete-workshop-confirmation"
          onChange={(event) => setConfirmationName(event.target.value)}
          placeholder={workshop.name}
          type="text"
          value={confirmationName}
        />

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="button-secondary" disabled={isDeleting} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="button-danger"
            disabled={!isConfirmed || isDeleting || isLastWorkshop}
            onClick={() => onConfirm(confirmationName)}
            type="button"
          >
            {isDeleting ? "Deleting..." : "Delete Workshop"}
          </button>
        </div>
      </section>
    </div>
  );
};

export default WorkshopDeleteModal;
