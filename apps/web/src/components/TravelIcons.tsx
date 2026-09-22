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
  <svg {...iconProps(className)}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

export const MapPinIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const ListIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);

export const XIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const MenuIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const LinkIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const ShareIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="m16 6-4-4-4 4M12 2v13" />
  </svg>
);

export const ChevronLeftIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const ChevronRightIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const PlaneIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="M22 2 9.4 14.6M15.5 5.5l3 15-5.1-5.1-5 3L2 22l2.6-6.4 3-5.1L2.5 5.5Z" />
  </svg>
);

export const BookIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z" />
    <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
  </svg>
);

export const ArrowUpIcon = ({ className }: IconProps) => (
  <svg {...iconProps(className)}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

// Brand marks are filled shapes, not strokes.
const brandProps = (className?: string) => ({
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "currentColor",
  className: className ?? "travel-icon",
  "aria-hidden": true,
});

export const YouTubeIcon = ({ className }: IconProps) => (
  <svg {...brandProps(className)}>
    <path d="M23 7.2a2.9 2.9 0 0 0-2-2C19.2 4.7 12 4.7 12 4.7s-7.2 0-9 .5a2.9 2.9 0 0 0-2 2C.5 9 .5 12 .5 12s0 3 .5 4.8a2.9 2.9 0 0 0 2 2c1.8.5 9 .5 9 .5s7.2 0 9-.5a2.9 2.9 0 0 0 2-2c.5-1.8.5-4.8.5-4.8s0-3-.5-4.8ZM9.8 15.1V8.9l6 3.1-6 3.1Z" />
  </svg>
);

export const XBrandIcon = ({ className }: IconProps) => (
  <svg {...brandProps(className)}>
    <path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
  </svg>
);

export const RssIcon = ({ className }: IconProps) => (
  <svg {...brandProps(className)}>
    <path d="M4 4.5a15.5 15.5 0 0 1 15.5 15.5h-2.9A12.6 12.6 0 0 0 4 7.4V4.5Zm0 5.6a9.9 9.9 0 0 1 9.9 9.9h-2.9A7 7 0 0 0 4 13V10.1ZM6 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
  </svg>
);
