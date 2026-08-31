type IconProps = { className?: string };

const iconProps = (className?: string) => ({
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: className ?? "travel-icon",
  "aria-hidden": true,
});

// Shared line icons carried over from the original travel-diary UI.
export const SearchIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
);

export const MapPinIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>
);

export const ListIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
);

export const XIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><path d="m6 6 12 12M18 6 6 18" /></svg>
);

export const MenuIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);

export const ShareIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4M12 2v13" /></svg>
);

export const ChevronLeftIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><path d="m15 18-6-6 6-6" /></svg>
);

export const ChevronRightIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><path d="m9 18 6-6-6-6" /></svg>
);

export const PlaneIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}><path d="M22 2 9.4 14.6M15.5 5.5l3 15-5.1-5.1-5 3L2 22l2.6-6.4 3-5.1L2.5 5.5Z" /></svg>
);
