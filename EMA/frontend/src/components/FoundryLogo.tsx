import React from "react";

interface FoundryLogoProps {
  variant?: "horizontal" | "icon" | "mono";
}

const FoundryMark: React.FC<{ mono?: boolean }> = ({ mono = false }) => (
  <svg className="foundry-mark" viewBox="0 0 96 96" role="img" aria-label="The Foundry mark">
    <defs>
      <linearGradient id="foundrySteel" x1="16" x2="80" y1="14" y2="84">
        <stop offset="0" stopColor={mono ? "#f7fbff" : "#F4F8FA"} />
        <stop offset="0.45" stopColor={mono ? "#dbe3e8" : "#808A91"} />
        <stop offset="1" stopColor={mono ? "#aeb8bf" : "#2D3238"} />
      </linearGradient>
      <linearGradient id="foundryBlue" x1="24" x2="82" y1="18" y2="76">
        <stop offset="0" stopColor="#7AEDFF" />
        <stop offset="1" stopColor="#00D4FF" />
      </linearGradient>
      <filter id="arcGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3.2" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0.831 0 0 0 0 1 0 0 0 0.85 0"
        />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <circle cx="48" cy="48" r="37" fill="none" stroke="#182128" strokeWidth="11" />
    <path
      d="M48 11a37 37 0 0 1 36 45"
      fill="none"
      stroke={mono ? "#F4F8FA" : "url(#foundryBlue)"}
      strokeLinecap="round"
      strokeWidth="8"
      filter={mono ? undefined : "url(#arcGlow)"}
    />
    <path
      d="M24 76A37 37 0 0 1 48 11"
      fill="none"
      stroke="url(#foundrySteel)"
      strokeLinecap="round"
      strokeWidth="10"
    />
    {!mono && (
      <path
        d="M50 7c3 8 2 14-2 19 7-4 11-9 10-17"
        fill="#FF8A00"
        filter="url(#arcGlow)"
      />
    )}
    <path
      d="M35 69V29h33l-6 10H47v8h17l-6 10H47v12H35Z"
      fill="url(#foundrySteel)"
      stroke={mono ? "#F4F8FA" : "#C8D0D5"}
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

const FoundryLogo: React.FC<FoundryLogoProps> = ({ variant = "horizontal" }) => {
  if (variant === "icon") {
    return <FoundryMark />;
  }

  const mono = variant === "mono";

  return (
    <div className={`foundry-logo ${mono ? "is-mono" : ""}`} aria-label="The Foundry">
      <FoundryMark mono={mono} />
      <div className="foundry-wordmark">
        <span>THE</span>
        <strong>FOUNDRY</strong>
      </div>
    </div>
  );
};

export default FoundryLogo;
