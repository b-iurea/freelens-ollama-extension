/**
 * Copyright (c) 2026 Freelens K8s SRE Assistant Authors.
 * Licensed under MIT License.
 */

export function SreIcon({ size = 16 }: { size?: string | number } = {}) {
  const px = typeof size === "string" ? parseFloat(size) || 16 : size;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="currentColor"
    >
      {/* Robot head */}
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      {/* Antenna */}
      <line x1="12" y1="8" x2="12" y2="4.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="3.5" r="1.5" />
      {/* Eyes */}
      <circle cx="9" cy="12.5" r="1.5" fill="var(--mainBackground, #1e1e2e)" />
      <circle cx="15" cy="12.5" r="1.5" fill="var(--mainBackground, #1e1e2e)" />
      {/* K8s helm wheel on forehead (simplified 7-spoke) */}
      <circle cx="12" cy="9.5" r="0.6" fill="var(--mainBackground, #1e1e2e)" />
      <line x1="12" y1="8.4" x2="12" y2="8.9" stroke="var(--mainBackground, #1e1e2e)" strokeWidth="0.5" />
      <line x1="12.95" y1="9" x2="12.55" y2="9.25" stroke="var(--mainBackground, #1e1e2e)" strokeWidth="0.5" />
      <line x1="12.75" y1="10.1" x2="12.4" y2="9.8" stroke="var(--mainBackground, #1e1e2e)" strokeWidth="0.5" />
      <line x1="11.25" y1="10.1" x2="11.6" y2="9.8" stroke="var(--mainBackground, #1e1e2e)" strokeWidth="0.5" />
      <line x1="11.05" y1="9" x2="11.45" y2="9.25" stroke="var(--mainBackground, #1e1e2e)" strokeWidth="0.5" />
      {/* Mouth */}
      <rect x="9.5" y="15" width="5" height="1" rx="0.5" fill="var(--mainBackground, #1e1e2e)" />
      {/* Ears / side details */}
      <rect x="3" y="11" width="2" height="3" rx="1" />
      <rect x="19" y="11" width="2" height="3" rx="1" />
    </svg>
  );
}
