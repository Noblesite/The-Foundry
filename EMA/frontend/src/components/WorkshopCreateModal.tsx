import React, { useEffect, useState } from "react";
import { CreateWorkshopRequest } from "../contracts/foundryApi";
import { WorkspaceSettings, resolveDefaultBaseModel } from "../domain/foundry";

interface WorkshopCreateModalProps {
  isOpen: boolean;
  isSaving: boolean;
  settings: WorkspaceSettings;
  onClose: () => void;
  onCreate: (request: CreateWorkshopRequest) => Promise<void>;
}

const WorkshopCreateModal: React.FC<WorkshopCreateModalProps> = ({
  isOpen,
  isSaving,
  settings,
  onClose,
  onCreate,
}) => {
  const defaultBaseModel = resolveDefaultBaseModel(settings);
  const [draft, setDraft] = useState<CreateWorkshopRequest>({
    name: `${settings.subjectMatter} Workshop`,
    subject: settings.subjectMatter,
    voiceTarget: settings.characterVoice,
    baseModel: defaultBaseModel,
  });

  useEffect(() => {
    if (isOpen) {
      setDraft({
        name: `${settings.subjectMatter} Workshop`,
        subject: settings.subjectMatter,
        voiceTarget: settings.characterVoice,
        baseModel: defaultBaseModel,
      });
    }
  }, [
    defaultBaseModel,
    isOpen,
    settings.characterVoice,
    settings.subjectMatter,
  ]);

  if (!isOpen) {
    return null;
  }

  const updateDraft = <K extends keyof CreateWorkshopRequest>(
    key: K,
    value: CreateWorkshopRequest[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submitWorkshop = async (event: React.FormEvent) => {
    event.preventDefault();
    await onCreate(draft);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workshop-modal panel-glass" role="dialog" aria-modal="true" aria-label="Create Workshop">
        <div className="modal-heading">
          <div>
            <p className="section-eyebrow">Workshop</p>
            <h2>New Workshop</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close new Workshop">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <form className="workshop-form" onSubmit={submitWorkshop}>
          <label className="field-label" htmlFor="workshop-name">Name</label>
          <input
            id="workshop-name"
            type="text"
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
            required
          />

          <label className="field-label" htmlFor="workshop-subject">Subject matter</label>
          <input
            id="workshop-subject"
            type="text"
            value={draft.subject}
            onChange={(event) => updateDraft("subject", event.target.value)}
            required
          />

          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="workshop-voice">Voice target</label>
              <input
                id="workshop-voice"
                type="text"
                value={draft.voiceTarget ?? ""}
                onChange={(event) => updateDraft("voiceTarget", event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="workshop-model">Base model</label>
              <input
                id="workshop-model"
                type="text"
                value={draft.baseModel ?? ""}
                onChange={(event) => updateDraft("baseModel", event.target.value)}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button className="button-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button-primary" type="submit" disabled={isSaving}>
              <i className="fas fa-plus" aria-hidden="true" />
              {isSaving ? "Creating" : "Create Workshop"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};

export default WorkshopCreateModal;
