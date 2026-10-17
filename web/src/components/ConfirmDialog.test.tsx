import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function setup() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Delete this recipe?"
      description="This cannot be undone."
      confirmLabel="Delete recipe"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel, dialog: screen.getByRole('alertdialog') };
}

describe('ConfirmDialog', () => {
  it('is an accessible modal dialog with a title and description', () => {
    const { dialog } = setup();
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAccessibleName('Delete this recipe?');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
  });

  it('confirms and cancels through its buttons', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete recipe' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('treats the Escape key (the dialog "cancel" event) as cancel and keeps state in React', () => {
    const { dialog, onCancel } = setup();
    const event = new Event('cancel', { bubbles: false, cancelable: true });
    fireEvent(dialog, event);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('cancels when the backdrop is clicked but not when the content is clicked', async () => {
    const user = userEvent.setup();
    const { dialog, onCancel } = setup();
    await user.click(screen.getByText('This cannot be undone.'));
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
