import { cloneElement, useId } from "react";
import type { ReactElement } from "react";

type AriaInvalid = boolean | "false" | "true" | "grammar" | "spelling";

export interface FieldControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaInvalid;
  "aria-errormessage"?: string;
}

export interface FieldProps {
  /** Visible label. It is wired to the control through `htmlFor`/`id`. */
  label: string;
  /** A single form control that accepts `id`, `aria-*` and `required`. */
  children: ReactElement;
  /** Overrides the generated control id. */
  id?: string;
  /** Error message. Sets `aria-invalid` and links the message with `aria-describedby`. */
  error?: string;
  /** Help text rendered between the control and the error. */
  help?: string;
  /** Marks the control as required and shows the visual indicator. */
  required?: boolean;
  className?: string;
}

/**
 * Label + control + help/error, with the ARIA wiring that is easy to forget.
 *
 * The control keeps its own id when it already has one; otherwise Field uses a
 * generated id so the label is always associated. Existing `aria-describedby`
 * values are preserved and combined with the help/error ids.
 */
export default function Field({
  label,
  children,
  id,
  error,
  help,
  required = false,
  className = "",
}: FieldProps) {
  const generatedId = useId().replace(/:/g, "");
  const childProps = children.props as FieldControlProps;
  const controlId = childProps.id ?? id ?? `field-${generatedId}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [childProps["aria-describedby"], helpId, errorId].filter(Boolean).join(" ") || undefined;

  const control = cloneElement(children, {
    id: controlId,
    required: required ? true : childProps.required,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : childProps["aria-invalid"],
    "aria-errormessage": error ? errorId : childProps["aria-errormessage"],
  } as FieldControlProps);

  return (
    <div className={`space-y-1 ${className}`.trim()}>
      <label htmlFor={controlId} className="block text-sm font-medium text-[var(--text-primary)]">
        {label}
        {required && (
          <span className="ml-1 text-[var(--color-danger)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {control}
      {help && (
        <p id={helpId} className="text-xs text-[var(--text-tertiary)]">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[var(--color-danger-text)]">
          {error}
        </p>
      )}
    </div>
  );
}
