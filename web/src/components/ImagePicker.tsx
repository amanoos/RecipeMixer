import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/** Client-side convenience check only; the server validates the real file content again. */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return 'Please choose a JPEG, PNG or WebP image.';
  if (file.size > MAX_BYTES) return 'The image must be 5 MB or smaller.';
  return null;
}

interface ImagePickerProps {
  existingUrl: string | null;
  file: File | null;
  onFileChange: (file: File | null) => void;
  removeExisting: boolean;
  onRemoveExistingChange: (remove: boolean) => void;
}

export function ImagePicker({
  existingUrl,
  file,
  onFileChange,
  removeExisting,
  onRemoveExistingChange,
}: ImagePickerProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A data: URL keeps the preview inside the strict Content-Security-Policy (blob: URLs are not allowed).
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (!cancelled && typeof reader.result === 'string') setPreview(reader.result);
    };
    reader.readAsDataURL(file);
    return () => {
      cancelled = true;
    };
  }, [file]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const problem = validateImageFile(selected);
    if (problem) {
      setError(problem);
      onFileChange(null);
      event.target.value = '';
      return;
    }
    setError(null);
    onFileChange(selected);
    onRemoveExistingChange(false);
  }

  function handleRemove() {
    onFileChange(null);
    if (inputRef.current) inputRef.current.value = '';
    if (existingUrl && !file) onRemoveExistingChange(true);
  }

  const shownUrl = preview ?? (removeExisting ? null : existingUrl);

  return (
    <div className="space-y-2">
      <Label htmlFor="recipe-image">Image</Label>
      {shownUrl ? (
        <img src={shownUrl} alt="Recipe preview" className="aspect-[4/3] w-full max-w-sm rounded-lg object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full max-w-sm items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ImageOff aria-hidden="true" className="size-8" />
        </div>
      )}
      <Input
        id="recipe-image"
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        aria-describedby="recipe-image-help"
      />
      <p id="recipe-image-help" className="text-xs text-muted-foreground">
        JPEG, PNG or WebP, up to 5 MB. Location data is removed when the image is saved.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {shownUrl && (
        <Button type="button" variant="outline" size="sm" onClick={handleRemove}>
          Remove image
        </Button>
      )}
    </div>
  );
}
