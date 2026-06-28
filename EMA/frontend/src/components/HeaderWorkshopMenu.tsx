import React, { useEffect, useMemo, useRef, useState } from "react";
import { Workshop } from "../domain/foundry";

interface HeaderWorkshopMenuProps {
  activeWorkshop: Workshop;
  workshops: Workshop[];
  onCreateWorkshop: () => void;
  onSelectWorkshop: (workshop: Workshop) => void;
}

const formatStatus = (status: Workshop["status"]) =>
  status
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");

const HeaderWorkshopMenu: React.FC<HeaderWorkshopMenuProps> = ({
  activeWorkshop,
  workshops,
  onCreateWorkshop,
  onSelectWorkshop,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const orderedWorkshops = useMemo(() => {
    const remainingWorkshops = workshops.filter((workshop) => workshop.id !== activeWorkshop.id);
    return [activeWorkshop, ...remainingWorkshops];
  }, [activeWorkshop, workshops]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const selectWorkshop = (workshop: Workshop) => {
    setIsOpen(false);
    if (workshop.id !== activeWorkshop.id) {
      onSelectWorkshop(workshop);
    }
  };

  const createWorkshop = () => {
    setIsOpen(false);
    onCreateWorkshop();
  };

  return (
    <div className="topbar-workshop-menu" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="topbar-workshop-trigger"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="topbar-workshop-copy">
          <span className="topbar-workshop-kicker">Current Workshop</span>
          <strong>{activeWorkshop.name}</strong>
          <small>
            {activeWorkshop.voiceTarget} / {formatStatus(activeWorkshop.status)}
          </small>
        </span>
        <i className={`fas ${isOpen ? "fa-chevron-up" : "fa-chevron-down"}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <div className="topbar-workshop-dropdown panel-glass" role="menu">
          <div className="topbar-workshop-dropdown-heading">
            <span>Switch Workshop</span>
            <small>{orderedWorkshops.length} saved</small>
          </div>

          <div className="topbar-workshop-options">
            {orderedWorkshops.map((workshop) => {
              const isActive = workshop.id === activeWorkshop.id;
              return (
                <button
                  aria-current={isActive ? "true" : undefined}
                  className={`topbar-workshop-option ${isActive ? "is-active" : ""}`}
                  key={workshop.id}
                  onClick={() => selectWorkshop(workshop)}
                  role="menuitem"
                  type="button"
                >
                  <span>
                    <strong>{workshop.name}</strong>
                    <small>
                      {workshop.voiceTarget} / {formatStatus(workshop.status)}
                    </small>
                  </span>
                  {isActive && <i className="fas fa-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <button
            className="topbar-workshop-create"
            onClick={createWorkshop}
            role="menuitem"
            type="button"
          >
            <i className="fas fa-plus" aria-hidden="true" />
            New Workshop
          </button>
        </div>
      )}
    </div>
  );
};

export default HeaderWorkshopMenu;
