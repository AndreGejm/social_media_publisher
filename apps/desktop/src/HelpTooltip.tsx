import {
  cloneElement,
  isValidElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState
} from "react";

type HelpTooltipVariant = "tooltip" | "popover";

type HelpTooltipProps = {
  content: ReactNode;
  title?: string;
  variant?: HelpTooltipVariant;
  children?: ReactElement;
  iconLabel?: string;
  className?: string;
  panelClassName?: string;
  side?: "top" | "bottom";
  testId?: string;
};

function composeEventHandler<E>(
  original: ((event: E) => void) | undefined,
  next: (event: E) => void
): (event: E) => void {
  return (event) => {
    original?.(event);
    next(event);
  };
}

/**
 * Accessible contextual help tooltip/popover wrapper.
 *
 * - Tooltip mode: lightweight hover/focus help for simple controls.
 * - Popover mode: richer content, typically used with the built-in `?` icon trigger.
 * - Supports Escape to dismiss and focus-triggered visibility for keyboard users.
 */
export function HelpTooltip({
  content,
  title,
  variant = "tooltip",
  children,
  iconLabel,
  className,
  panelClassName,
  side = "top",
  testId
}: HelpTooltipProps) {
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  const close = () => {
    setOpen(false);
    setPinned(false);
  };

  const openTransient = () => {
    setOpen(true);
  };

  const maybeCloseTransient = () => {
    if (!pinned) {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !pinned) return;

    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!root.contains(target)) {
        close();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, pinned]);

  const sharedTriggerProps = {
    "aria-describedby": open ? tooltipId : undefined,
    onMouseEnter: () => openTransient(),
    onMouseLeave: () => maybeCloseTransient(),
    onFocus: () => openTransient(),
    onBlur: (event: { relatedTarget: EventTarget | null }) => {
      const root = rootRef.current;
      const nextTarget = event.relatedTarget;
      if (root && nextTarget instanceof Node && root.contains(nextTarget)) {
        return;
      }
      maybeCloseTransient();
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
  };

  let trigger: ReactNode;
  if (children && isValidElement(children)) {
    const childElement = children as ReactElement<Record<string, unknown>>;
    const childProps = childElement.props;
    trigger = cloneElement(childElement, {
      "aria-describedby": open ? tooltipId : childProps["aria-describedby"],
      onMouseEnter: composeEventHandler(
        childProps.onMouseEnter as ((event: ReactMouseEvent<HTMLElement>) => void) | undefined,
        sharedTriggerProps.onMouseEnter
      ),
      onMouseLeave: composeEventHandler(
        childProps.onMouseLeave as ((event: ReactMouseEvent<HTMLElement>) => void) | undefined,
        sharedTriggerProps.onMouseLeave
      ),
      onFocus: composeEventHandler(
        childProps.onFocus as ((event: React.FocusEvent<HTMLElement>) => void) | undefined,
        sharedTriggerProps.onFocus
      ),
      onBlur: composeEventHandler(
        childProps.onBlur as ((event: React.FocusEvent<HTMLElement>) => void) | undefined,
        sharedTriggerProps.onBlur as (event: React.FocusEvent<HTMLElement>) => void
      ),
      onKeyDown: composeEventHandler(
        childProps.onKeyDown as ((event: ReactKeyboardEvent<HTMLElement>) => void) | undefined,
        sharedTriggerProps.onKeyDown
      )
    });
  } else {
    const label = iconLabel ?? "Help";
    trigger = (
      <button
        type="button"
        className={`help-tooltip-icon${variant === "popover" ? " popover" : ""}`}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={variant === "popover" ? open : undefined}
        onMouseEnter={sharedTriggerProps.onMouseEnter}
        onMouseLeave={sharedTriggerProps.onMouseLeave}
        onFocus={sharedTriggerProps.onFocus}
        onBlur={sharedTriggerProps.onBlur as (event: React.FocusEvent<HTMLButtonElement>) => void}
        onKeyDown={sharedTriggerProps.onKeyDown as (event: ReactKeyboardEvent<HTMLButtonElement>) => void}
        onClick={() => {
          if (variant === "popover") {
            setPinned((current) => {
              const next = !current;
              setOpen(next);
              return next;
            });
          }
        }}
        data-testid={testId}
      >
        ?
      </button>
    );
  }

  const popupClasses = [
    "help-tooltip-panel",
    `side-${side}`,
    `variant-${variant}`,
    open ? "open" : "closed",
    panelClassName
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={["help-tooltip-root", className].filter(Boolean).join(" ")} ref={rootRef}>
      {trigger}
      <div id={tooltipId} role="tooltip" className={popupClasses} aria-hidden={!open}>
        {title ? <strong className="help-tooltip-title">{title}</strong> : null}
        <div className="help-tooltip-content">{content}</div>
      </div>
    </span>
  );
}
