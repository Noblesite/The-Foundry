import React from "react";

interface ProgressRingProps {
  value: number;
  label?: string;
  size?: number;
}

const ProgressRing: React.FC<ProgressRingProps> = ({ value, label, size = 118 }) => {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(Math.max(value, 0), 100) / 100) * circumference;

  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 110 110" aria-label={`${value}% ${label ?? "complete"}`}>
        <circle className="progress-ring-track" cx="55" cy="55" r={radius} />
        <circle
          className="progress-ring-fill"
          cx="55"
          cy="55"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="progress-ring-label">
        <strong>{value}%</strong>
        {label && <span>{label}</span>}
      </div>
    </div>
  );
};

export default ProgressRing;
