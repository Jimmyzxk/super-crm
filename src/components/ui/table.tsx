import React from "react";

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  children,
  className = "",
  ...props
}) => (
  <div className="w-full overflow-x-auto">
    <table className={`min-w-full divide-y divide-slate-200 text-left text-xs ${className}`} {...props}>
      {children}
    </table>
  </div>
);

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  children,
  className = "",
  ...props
}) => (
  <thead className={`bg-slate-50/80 font-semibold text-slate-500 uppercase tracking-wider text-[11px] select-none ${className}`} {...props}>
    {children}
  </thead>
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  children,
  className = "",
  ...props
}) => (
  <tbody className={`divide-y divide-slate-100 bg-white ${className}`} {...props}>
    {children}
  </tbody>
);

export const TableRow: React.FC<
  React.HTMLAttributes<HTMLTableRowElement> & { isSelected?: boolean; isClickable?: boolean }
> = ({ children, className = "", isSelected = false, isClickable = false, ...props }) => (
  <tr
    className={`transition-colors ${
      isClickable ? "cursor-pointer" : ""
    } ${
      isSelected
        ? "bg-slate-50/90 border-l-2 border-slate-900"
        : "hover:bg-slate-50/60"
    } ${className}`}
    {...props}
  >
    {children}
  </tr>
);

export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  children,
  className = "",
  ...props
}) => (
  <th scope="col" className={`px-3.5 py-2.5 font-semibold text-slate-500 text-[11px] ${className}`} {...props}>
    {children}
  </th>
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  children,
  className = "",
  ...props
}) => (
  <td className={`px-3.5 py-3 text-slate-700 ${className}`} {...props}>
    {children}
  </td>
);
