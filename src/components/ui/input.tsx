import React, { forwardRef } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClear?: () => void;
  error?: string;
  inputSize?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-7.5 text-xs px-2.5",
  md: "h-8.5 text-xs px-3",
  lg: "h-10 text-sm px-3.5",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = "",
      leftIcon,
      rightIcon,
      onClear,
      value,
      error,
      inputSize = "md",
      disabled,
      ...props
    },
    ref
  ) => {
    const hasClear = Boolean(onClear && value);

    return (
      <div className="relative flex items-center w-full">
        {leftIcon && (
          <div className="pointer-events-none absolute left-2.5 flex items-center text-slate-400">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          value={value}
          disabled={disabled}
          className={`w-full rounded-lg border bg-white text-slate-900 placeholder:text-slate-400 transition shadow-2xs outline-none disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
            error
              ? "border-rose-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600"
              : "border-slate-200 focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
          } ${leftIcon ? "pl-8" : ""} ${rightIcon || hasClear ? "pr-8" : ""} ${
            sizeClasses[inputSize]
          } ${className}`}
          {...props}
        />
        {hasClear ? (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 text-slate-400 hover:text-slate-700 text-xs font-bold p-1 cursor-pointer transition-colors"
            title="清空"
          >
            ✕
          </button>
        ) : (
          rightIcon && (
            <div className="pointer-events-none absolute right-2.5 flex items-center text-slate-400">
              {rightIcon}
            </div>
          )
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
