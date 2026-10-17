import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ImagePicker, validateImageFile } from './ImagePicker';
import { pngFile } from '@/test-utils';

function Harness({ existingUrl = null }: { existingUrl?: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [remove, setRemove] = useState(false);
  return (
    <>
      <ImagePicker
        existingUrl={existingUrl}
        file={file}
        onFileChange={setFile}
        removeExisting={remove}
        onRemoveExistingChange={setRemove}
      />
      <output data-testid="state">{`${file ? file.name : 'none'}|${String(remove)}`}</output>
    </>
  );
}

// applyAccept is off so that disallowed files reach our own validation instead of being filtered by the browser model.
const setup = () => userEvent.setup({ applyAccept: false });

describe('validateImageFile', () => {
  it('accepts JPEG, PNG and WebP up to 5 MB', () => {
    const mb5 = 5 * 1024 * 1024;
    expect(validateImageFile(new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' }))).toBeNull();
    expect(validateImageFile(new File([new Uint8Array(10)], 'a.webp', { type: 'image/webp' }))).toBeNull();
    expect(validateImageFile(new File([new Uint8Array(mb5)], 'a.png', { type: 'image/png' }))).toBeNull();
  });

  it('rejects other types and oversized files', () => {
    expect(validateImageFile(new File(['x'], 'a.gif', { type: 'image/gif' }))).toMatch(/JPEG, PNG or WebP/);
    expect(validateImageFile(new File(['x'], 'a.svg', { type: 'image/svg+xml' }))).toMatch(/JPEG, PNG or WebP/);
    expect(validateImageFile(pngFile('big.png', 5 * 1024 * 1024 + 1))).toMatch(/5 MB/);
  });
});

describe('ImagePicker', () => {
  it('previews a chosen image', async () => {
    const user = setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText('Image'), pngFile('soup.png'));

    const preview = await screen.findByAltText('Recipe preview');
    expect(preview.getAttribute('src')).toMatch(/^data:/);
    expect(screen.getByTestId('state')).toHaveTextContent('soup.png|false');
  });

  it('rejects a file over 5 MB', async () => {
    const user = setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText('Image'), pngFile('big.png', 6 * 1024 * 1024));
    expect(await screen.findByRole('alert')).toHaveTextContent(/5 MB or smaller/);
    expect(screen.getByTestId('state')).toHaveTextContent('none|false');
  });

  it('rejects a file that is not a supported image type', async () => {
    const user = setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText('Image'), new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/JPEG, PNG or WebP/);
    expect(screen.getByTestId('state')).toHaveTextContent('none|false');
  });

  it('shows the existing image and lets the user remove it', async () => {
    const user = setup();
    render(<Harness existingUrl="/api/images/abc.webp" />);
    expect(screen.getByAltText('Recipe preview')).toHaveAttribute('src', '/api/images/abc.webp');

    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.queryByAltText('Recipe preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('state')).toHaveTextContent('none|true');
  });

  it('choosing a new image cancels a pending removal', async () => {
    const user = setup();
    render(<Harness existingUrl="/api/images/abc.webp" />);
    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    await user.upload(screen.getByLabelText('Image'), pngFile('new.png'));
    expect(await screen.findByAltText('Recipe preview')).toBeInTheDocument();
    expect(screen.getByTestId('state')).toHaveTextContent('new.png|false');
  });
});
