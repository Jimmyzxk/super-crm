import React, { forwardRef } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "success"
  | "link";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950 border border-transparent shadow-xs focus-visible:ring-slate-900",
  secondary:
    "bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 border border-slate-200 shadow-2xs focus-visible:ring-slate-400",
  outline:
    "bg-transparent text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 border border-slate-200 focus-visible:ring-slate-400",
  ghost:
    "bg-transparent text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 border border-transparent focus-visible:ring-slate-400",
  danger:
    "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 border border-transparent shadow-xs focus-visible:ring-rose-500",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 border border-transparent shadow-xs focus-visible:ring-emerald-500",
  link: "bg-transparent text-slate-900 hover:underline p-0 h-auto border-0 shadow-none focus-visible:ring-0",
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[11px] rounded-md gap-1",
  sm: "h-7.5 px-2.5 text-xs rounded-md gap-1.5",
  md: "px-3.5 py-1.5 text-xs font-semibold rounded-lg gap-1.5",
  lg: "h-10 px-4 text-sm font-semibold rounded-lg gap-2",
  icon: "h-8.5 w-8.5 p-0 rounded-lg justify-center",
  "icon-sm": "h-7 w-7 p-0 rounded-md justify-center",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = "",
      variant = "secondary",
      size = "md",
      isLoading = false,
      disabled = false,
      leftIcon,
      rightIcon,
      type = "button",
      ...props
    },
    ref
  ) => {
    const isLink = variant === "link";
    const baseClasses = isLink
      ? "inline-flex items-center font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      : "inline-flex items-center justify-center font-medium transition-all duration-150 select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <svg
            className="animate-spin h-3.5 w-3.5 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        {children}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = "Button";
