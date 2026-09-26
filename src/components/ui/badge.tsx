import React from "react";

export type BadgeVariant =
  | "neutral"
  | "blue"
  | "emerald"
  | "amber"
  | "rose"
  | "purple"
  | "teal";

export type BadgeSize = "sm" | "md" | "lg";
export type BadgeShape = "rounded" | "pill";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  shape?: BadgeShape;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, { bg: string; dot: string }> = {
  neutral: {
    bg: "bg-slate-100 text-slate-700 border-slate-200/80",
    dot: "bg-slate-400",
  },
  blue: {
    bg: "bg-blue-50 text-blue-700 border-blue-200/80",
    dot: "bg-blue-500",
  },
  emerald: {
    bg: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
    dot: "bg-emerald-500",
  },
  amber: {
    bg: "bg-amber-50 text-amber-800 border-amber-200/80",
    dot: "bg-amber-500",
  },
  rose: {
    bg: "bg-rose-50 text-rose-700 border-rose-200/80",
    dot: "bg-rose-500",
  },
  purple: {
    bg: "bg-purple-50 text-purple-700 border-purple-200/80",
    dot: "bg-purple-500",
  },
  teal: {
    bg: "bg-teal-50 text-teal-700 border-teal-200/80",
    dot: "bg-teal-500",
  },
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "text-[10px] px-1.5 py-0.2 gap-1",
  md: "text-[11px] px-2 py-0.5 gap-1.5",
  lg: "text-xs px-2.5 py-1 gap-1.5",
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  className = "",
  variant = "neutral",
  size = "md",
  shape = "rounded",
  dot = false,
  ...props
}) => {
  const current = variantStyles[variant];
  const shapeClass = shape === "pill" ? "rounded-full" : "rounded-md";

  return (
    <span
      className={`inline-flex items-center font-medium border shrink-0 select-none ${shapeClass} ${current.bg} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${current.dot}`} />}
      {children}
    </span>
  );
};
