import type { ReactNode } from "react";
import QueryState from "./QueryState";

interface PageStateCommon {
  className?: string;
}

export type PageStateProps =
  | (PageStateCommon & {
      state: "loading";
      /** Replaces the default card skeleton. */
      skeleton?: ReactNode;
    })
  | (PageStateCommon & {
      state: "error";
      onRetry?: () => void;
      errorMessage?: string;
    })
  | (PageStateCommon & {
      state: "empty";
      emptyTitle?: string;
      emptyDescription?: string;
      emptyAction?: { label: string; onClick: () => void };
    })
  | (PageStateCommon & {
      state: "success";
      children: ReactNode;
    });

/**
 * The four page-level states as one explicit contract.
 *
 * `loading`, `error` and `empty` delegate to `QueryState`, so the visual and
 * ARIA behavior stays identical to the inline query states introduced in #511.
 * `success` renders the page content untouched.
 */
export default function PageState(props: PageStateProps) {
  if (props.state === "success") {
    return <div className={props.className}>{props.children}</div>;
  }

  return (
    <div className={props.className} aria-busy={props.state === "loading" || undefined}>
      {props.state === "loading" && (
        <QueryState isLoading skeleton={props.skeleton}>
          <></>
        </QueryState>
      )}
      {props.state === "error" && (
        <QueryState
          isError
          hasData={false}
          onRetry={props.onRetry}
          errorMessage={props.errorMessage}
        >
          <></>
        </QueryState>
      )}
      {props.state === "empty" && (
        <QueryState
          isEmpty
          emptyTitle={props.emptyTitle}
          emptyDescription={props.emptyDescription}
          emptyAction={props.emptyAction}
        >
          <></>
        </QueryState>
      )}
    </div>
  );
}
