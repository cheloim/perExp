import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

export type SortDirection = "ascending" | "descending" | "none";

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Table caption. It is exposed as the accessible name of the table. */
  caption?: ReactNode;
  /** Keeps the caption for assistive tech but hides it visually. */
  captionHidden?: boolean;
}

/** Semantic table with an optional caption. */
export default function Table({
  caption,
  captionHidden = false,
  className = "",
  children,
  ...rest
}: TableProps) {
  return (
    <table className={`w-full border-collapse ${className}`.trim()} {...rest}>
      {caption && (
        <caption
          className={captionHidden ? "sr-only" : "text-left text-sm text-[var(--text-secondary)]"}
        >
          {caption}
        </caption>
      )}
      {children}
    </table>
  );
}

export function TableHead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Maps to `aria-sort`. Only use it on sortable columns. */
  sort?: SortDirection;
  /** When present, the header content becomes a button that triggers the sort. */
  onSort?: () => void;
}

/**
 * Header cell with `scope="col"` by default and an `aria-sort` helper.
 *
 * A sortable header keeps the button *inside* the `<th>` so the sort state and
 * the control have the same owner.
 */
export function TableHeaderCell({
  sort,
  onSort,
  scope = "col",
  className = "",
  children,
  ...rest
}: TableHeaderCellProps) {
  const ariaSort = onSort ? (sort ?? "none") : sort;

  return (
    <th scope={scope} aria-sort={ariaSort} className={`text-left ${className}`.trim()} {...rest}>
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className="inline-flex w-full items-center gap-1 text-left"
        >
          {children}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TableCell({ className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={className} {...rest} />;
}
