import type { SVGProps } from 'react';

/**
 * A plasma cutting torch: the body, the tapered nozzle, the arc, and the kerf it leaves.
 *
 * Drawn rather than borrowed. Lucide has no torch, and the flame that stood here before reads
 * as oxy-fuel — the one process a plasma table is not. Same conventions as the lucide icons it
 * sits beside (24 unit box, stroke only, round caps and joins) so it does not look like a
 * guest in the sidebar.
 */
export function PlasmaTorchIcon({
  strokeWidth = 2,
  ...props
}: SVGProps<SVGSVGElement> & { strokeWidth?: number | string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* torch body, held at the top */}
      <path d="M9.5 2.5h5a1 1 0 0 1 1 1v6.5h-7V3.5a1 1 0 0 1 1-1Z" />
      {/* the nozzle, tapering to the orifice */}
      <path d="M8.5 10h7l-1.5 3.5h-4L8.5 10Z" />
      {/* the arc, struck from the orifice to the plate */}
      <path d="M12 13.5v4" />
      {/* the plate, with the kerf the arc has opened in it */}
      <path d="M3 18.5h6.5M14.5 18.5H21" />
      {/* sparks either side of the cut */}
      <path d="M9 21.5l1-1.5M15 21.5l-1-1.5" />
    </svg>
  );
}
