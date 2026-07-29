import { useEffect, useRef } from "react";

/**
 * Tung Tung Tung Sahur — the anomaly itself. An anthropomorphic kentongan
 * (Indonesian slit drum) holding a pentungan bat. If you are called for
 * sahur three times and do not answer, this brand mark comes to your house.
 *
 * With `watchCursor`, the pupils track the pointer anywhere in the window.
 * He is watching. He has always been watching.
 */
export function SahurMark(props: { readonly className?: string; readonly watchCursor?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pupilsRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!props.watchCursor) return;
    let frame: number | null = null;
    const onPointerMove = (event: PointerEvent) => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const svg = svgRef.current;
        const pupils = pupilsRef.current;
        if (!svg || !pupils) return;
        const rect = svg.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height * 0.45;
        const dx = event.clientX - centerX;
        const dy = event.clientY - centerY;
        const distance = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, distance / 160);
        const offsetX = (dx / distance) * 3.5 * reach;
        const offsetY = (dy / distance) * 3.5 * reach;
        pupils.setAttribute("transform", `translate(${offsetX} ${offsetY})`);
      });
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [props.watchCursor]);

  return (
    <svg
      ref={svgRef}
      aria-label="Tung Tung Tung Sahur"
      className={props.className}
      viewBox="0 0 120 150"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* pentungan (bat), resting on the shoulder */}
      <g transform="rotate(38 92 96)">
        <rect x="86" y="26" width="12" height="76" rx="6" fill="#c89b62" />
        <rect x="83" y="18" width="18" height="26" rx="9" fill="#b9854a" />
      </g>
      {/* log body */}
      <rect x="30" y="18" width="60" height="118" rx="26" fill="#8a5a2b" />
      <rect
        x="30"
        y="18"
        width="60"
        height="118"
        rx="26"
        fill="none"
        stroke="#6f4520"
        strokeWidth="4"
      />
      {/* end-grain cap */}
      <ellipse cx="60" cy="24" rx="26" ry="9" fill="#a9723a" />
      <ellipse cx="60" cy="24" rx="15" ry="5" fill="#c08a4b" />
      {/* kentongan slit */}
      <rect x="54" y="112" width="12" height="18" rx="6" fill="#5b3a1c" />
      {/* wide, unblinking eyes */}
      <ellipse cx="47" cy="62" rx="11" ry="13" fill="#ffffff" />
      <ellipse cx="73" cy="62" rx="11" ry="13" fill="#ffffff" />
      <g ref={pupilsRef}>
        <circle cx="47" cy="64" r="5.5" fill="#1c1208" />
        <circle cx="73" cy="64" r="5.5" fill="#1c1208" />
        <circle cx="45" cy="61" r="2" fill="#ffffff" />
        <circle cx="71" cy="61" r="2" fill="#ffffff" />
      </g>
      {/* open mouth, mid-tung */}
      <ellipse cx="60" cy="92" rx="13" ry="10" fill="#3d2410" />
      <rect x="50" y="84" width="20" height="6" rx="3" fill="#ffffff" />
      {/* stick arms */}
      <path
        d="M30 86 Q16 92 14 104"
        stroke="#6f4520"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M90 84 Q100 86 104 78"
        stroke="#6f4520"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      {/* feet */}
      <ellipse cx="46" cy="140" rx="12" ry="7" fill="#6f4520" />
      <ellipse cx="74" cy="140" rx="12" ry="7" fill="#6f4520" />
    </svg>
  );
}
