import { useEffect, useId, useRef, type MouseEvent, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal confirmation built on the native <dialog> element. It is shown as soon as it is mounted.
 * Unlike a script-driven overlay it needs no inline styles, so it works under the strict
 * Content-Security-Policy, and the browser provides the focus trap and Escape handling.
 * Focus starts on "Cancel" (the first button) so a destructive action is never the default.
 */
export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Escape fires "cancel"; keep React state as the single source of truth instead of letting the browser close it.
  function handleCancelEvent(event: SyntheticEvent) {
    event.preventDefault();
    onCancel();
  }

  // A click on the backdrop is delivered to the <dialog> element itself, not to its content.
  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={handleCancelEvent}
      onClick={handleClick}
      className="m-auto w-full max-w-sm rounded-xl border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">
        {description}
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
