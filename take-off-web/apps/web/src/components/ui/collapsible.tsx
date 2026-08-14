import * as React from 'react';

// Minimal collapsible primitive (no Radix dependency) — sufficient for
// PDFOutlineDialog's collapsible outline rows.

interface CollapsibleProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

interface CollapsibleContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null);

export const Collapsible: React.FC<CollapsibleProps> = ({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div className={className} data-state={open ? 'open' : 'closed'}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
};

interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  ({ onClick, children, ...rest }, ref) => {
    const ctx = React.useContext(CollapsibleContext);
    return (
      <button
        type="button"
        ref={ref}
        data-state={ctx?.open ? 'open' : 'closed'}
        onClick={(e) => {
          ctx?.setOpen(!ctx.open);
          onClick?.(e);
        }}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export const CollapsibleContent = React.forwardRef<HTMLDivElement, CollapsibleContentProps>(
  ({ children, ...rest }, ref) => {
    const ctx = React.useContext(CollapsibleContext);
    if (!ctx?.open) return null;
    return (
      <div ref={ref} data-state="open" {...rest}>
        {children}
      </div>
    );
  }
);
CollapsibleContent.displayName = 'CollapsibleContent';
