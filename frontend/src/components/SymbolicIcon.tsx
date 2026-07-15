export type IconName =
  | "bot"
  | "chart-bar"
  | "chart-donut"
  | "card"
  | "bank"
  | "shield"
  | "lock"
  | "trash"
  | "sparkles"
  | "github"
  | "chevron"
  | "check"
  | "telegram"
  | "arrow-up-right"
  | "mail"
  | "key"
  | "eye";

const icons: Record<IconName, string> = {
  bot: "M12 2a2 2 0 0 1 2 2v1h3a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-1v1a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-1H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3V4a2 2 0 0 1 2-2h0zM9 8.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM15 8.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM9 14h6v1a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-1z",
  "chart-bar": "M4 20h16M6 20V10m4 10V6m4 14V14m4 6V8",
  "chart-donut":
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  card: "M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3H2V6zm0 5h20v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4zm3 7h4",
  bank: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3",
  shield: "M12 2l8 4v6c0 5.25-3.5 9.74-8 11-4.5-1.26-8-5.75-8-11V6l8-4z",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zm5 4v2m4-2v2",
  trash:
    "M4 6h16M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12zM10 10v7m4-7v7",
  sparkles:
    "M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2zm7 9l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z",
  github:
    "M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.49.5.09.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.268 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.026 2.747-1.026.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z",
  chevron: "M9 18l6-6-6-6",
  check: "M5 13l4 4L19 7",
  telegram: "M22 2L11 13m11-11l-3.5 19L11 13l-5.5 3L22 2z",
  "arrow-up-right": "M7 17L17 7m0 0H7m10 0v10",
  mail: "M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z",
  key: "M15.5 2.5a3.5 3.5 0 0 1 2.8 5.7l-8.5 8.5-2.8.3.3-2.8 8.5-8.5a3.5 3.5 0 0 1 .7-.2zM11 13l-2 2m5-1l-2 2",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zm11-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
};

interface SymbolicIconProps {
  name: IconName;
  className?: string;
  size?: number;
}

export default function SymbolicIcon({ name, className = "", size = 24 }: SymbolicIconProps) {
  const d = icons[name];
  if (!d) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
