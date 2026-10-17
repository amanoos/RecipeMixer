import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StarRating } from './StarRating';

describe('StarRating (read-only)', () => {
  it('describes the rating for assistive technology', () => {
    render(<StarRating value={4} />);
    expect(screen.getByRole('img', { name: 'Rated 4 out of 5' })).toBeInTheDocument();
  });

  it('describes a missing rating', () => {
    render(<StarRating value={null} />);
    expect(screen.getByRole('img', { name: 'Not rated' })).toBeInTheDocument();
  });

  it('is not interactive', () => {
    render(<StarRating value={3} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('StarRating (editable)', () => {
  it('reports the clicked star and marks the current one as pressed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<StarRating value={null} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Rate 4 out of 5' }));
    expect(onChange).toHaveBeenCalledWith(4);

    rerender(<StarRating value={4} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Rate 4 out of 5' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rate 3 out of 5' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clears the rating when the current star is clicked again', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StarRating value={2} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Rate 2 out of 5' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('can be operated with the keyboard', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StarRating value={null} onChange={onChange} />);
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
