import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ImagePicker } from '@/components/ImagePicker';
import { StarRating } from '@/components/StarRating';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, createRecipe, deleteImage, getRecipe, updateRecipe, uploadImage } from '@/lib/api';
import type { RecipeInput } from '@/lib/types';

/** One entry per line; blank lines are dropped. */
const toLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

type LoadState = 'loading' | 'ready' | 'missing';

export function RecipeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editId = id !== undefined ? Number(id) : null;
  const isEdit = editId !== null;

  const [loadState, setLoadState] = useState<LoadState>(isEdit ? 'loading' : 'ready');
  // After the recipe is saved once, further submits update it (so a failed image upload cannot create duplicates).
  const [savedId, setSavedId] = useState<number | null>(editId);

  const [title, setTitle] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [description, setDescription] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [ingredients, setIngredients] = useState('');
  const [steps, setSteps] = useState('');
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editId === null) return;
    if (!Number.isInteger(editId) || editId < 1) {
      setLoadState('missing');
      return;
    }
    const controller = new AbortController();
    getRecipe(editId, controller.signal)
      .then((recipe) => {
        setTitle(recipe.title);
        setCuisine(recipe.cuisine ?? '');
        setSourceUrl(recipe.sourceUrl ?? '');
        setDescription(recipe.description ?? '');
        setRating(recipe.rating);
        setIngredients(recipe.ingredients.join('\n'));
        setSteps(recipe.steps.join('\n'));
        setExistingImageUrl(recipe.imageUrl);
        setLoadState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState('missing');
      });
    return () => controller.abort();
  }, [editId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!title.trim()) {
      setTitleError('Title is required.');
      return;
    }
    setTitleError(null);

    const input: RecipeInput = {
      title: title.trim(),
      cuisine: cuisine.trim() || null,
      description: description.trim() || null,
      sourceUrl: sourceUrl.trim() || null,
      rating,
      ingredients: toLines(ingredients),
      steps: toLines(steps),
    };

    setSaving(true);
    let recipeId = savedId;
    try {
      const saved = recipeId === null ? await createRecipe(input) : await updateRecipe(recipeId, input);
      recipeId = saved.id;
      setSavedId(saved.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the recipe. Is the server running?');
      setSaving(false);
      return;
    }

    try {
      if (imageFile) {
        await uploadImage(recipeId, imageFile);
      } else if (removeImage && existingImageUrl) {
        await deleteImage(recipeId);
      }
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : 'the server could not be reached';
      setFormError(`The recipe was saved, but the image could not be saved: ${reason}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    navigate(`/recipes/${recipeId}`);
  }

  if (loadState === 'loading') {
    return <p aria-busy="true">Loading recipe...</p>;
  }

  if (loadState === 'missing') {
    return (
      <div className="space-y-3 py-16 text-center">
        <h1 className="text-xl font-semibold">Recipe not found</h1>
        <Link to="/" className={buttonVariants({ variant: 'outline' })}>
          Back to your recipes
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold">{isEdit ? 'Edit recipe' : 'New recipe'}</h1>

      <div className="space-y-2">
        <Label htmlFor="recipe-title">Title</Label>
        <Input
          id="recipe-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          aria-invalid={titleError !== null}
          aria-describedby={titleError ? 'recipe-title-error' : undefined}
        />
        {titleError && (
          <p id="recipe-title-error" role="alert" className="text-sm text-destructive">
            {titleError}
          </p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="recipe-cuisine">Cuisine</Label>
          <Input
            id="recipe-cuisine"
            value={cuisine}
            onChange={(event) => setCuisine(event.target.value)}
            maxLength={80}
            placeholder="e.g. Italian"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recipe-source">Source link</Label>
          <Input
            id="recipe-source"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            inputMode="url"
            maxLength={2048}
            placeholder="https://..."
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Your rating</Label>
        <div>
          <StarRating value={rating} onChange={setRating} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="recipe-description">Description</Label>
        <Textarea
          id="recipe-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={5000}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="recipe-ingredients">Ingredients</Label>
        <Textarea
          id="recipe-ingredients"
          value={ingredients}
          onChange={(event) => setIngredients(event.target.value)}
          rows={6}
          aria-describedby="recipe-ingredients-help"
        />
        <p id="recipe-ingredients-help" className="text-xs text-muted-foreground">
          One ingredient per line, for example "2 cups chopped onion".
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="recipe-steps">Steps</Label>
        <Textarea
          id="recipe-steps"
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
          rows={6}
          aria-describedby="recipe-steps-help"
        />
        <p id="recipe-steps-help" className="text-xs text-muted-foreground">
          One step per line.
        </p>
      </div>

      <ImagePicker
        existingUrl={existingImageUrl}
        file={imageFile}
        onFileChange={setImageFile}
        removeExisting={removeImage}
        onRemoveExistingChange={setRemoveImage}
      />

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save recipe'}
        </Button>
        <Link
          to={isEdit && editId !== null ? `/recipes/${editId}` : '/'}
          className={buttonVariants({ variant: 'outline' })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
