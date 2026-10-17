import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/connection.js';
import {
  countImageReferences,
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  setRecipeImage,
  updateRecipe,
} from '../db/recipes.js';
import { badRequest, notFound, payloadTooLarge, unsupportedMediaType } from '../errors.js';
import { listQuerySchema, parseOrThrow, recipeInputSchema } from '../schemas/recipe.js';
import { processImage, type ImageStore } from '../services/images.js';

/** Ids are positive integers; anything else is simply "not found" and never reaches SQL. */
function parseId(raw: string): number {
  if (!/^[1-9]\d{0,8}$/.test(raw)) throw notFound('Recipe not found');
  return Number(raw);
}

function requireRecipe(db: Db, id: number) {
  const recipe = getRecipe(db, id);
  if (!recipe) throw notFound('Recipe not found');
  return recipe;
}

/** Image files are content-addressed and may be shared, so delete only when nothing references them. */
async function removeImageIfUnused(db: Db, images: ImageStore, filename: string | null): Promise<void> {
  if (filename && countImageReferences(db, filename) === 0) {
    await images.remove(filename);
  }
}

export const recipeRoutes: FastifyPluginAsync<{ db: Db; images: ImageStore }> = async (app, { db, images }) => {
  app.get('/api/recipes', async (req) => listRecipes(db, parseOrThrow(listQuerySchema, req.query)));

  app.post('/api/recipes', async (req, reply) => {
    const input = parseOrThrow(recipeInputSchema, req.body);
    const id = createRecipe(db, input);
    reply.status(201);
    return requireRecipe(db, id);
  });

  app.get<{ Params: { id: string } }>('/api/recipes/:id', async (req) =>
    requireRecipe(db, parseId(req.params.id)),
  );

  app.put<{ Params: { id: string } }>('/api/recipes/:id', async (req) => {
    const id = parseId(req.params.id);
    const input = parseOrThrow(recipeInputSchema, req.body);
    if (!updateRecipe(db, id, input)) throw notFound('Recipe not found');
    return requireRecipe(db, id);
  });

  app.delete<{ Params: { id: string } }>('/api/recipes/:id', async (req, reply) => {
    const { deleted, imagePath } = deleteRecipe(db, parseId(req.params.id));
    if (!deleted) throw notFound('Recipe not found');
    await removeImageIfUnused(db, images, imagePath);
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string } }>('/api/recipes/:id/image', async (req) => {
    const id = parseId(req.params.id);
    requireRecipe(db, id);
    if (!req.isMultipart()) {
      throw unsupportedMediaType('Expected multipart/form-data with an "image" file');
    }

    const file = await req.file();
    if (!file || file.fieldname !== 'image') throw badRequest('Missing "image" file');

    let upload: Buffer;
    try {
      upload = await file.toBuffer();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 413) {
        throw payloadTooLarge('Image too large (max 5 MB)');
      }
      throw err;
    }

    const { data, filename } = await processImage(upload);
    await images.save(filename, data);
    const { previous } = setRecipeImage(db, id, filename);
    if (previous && previous !== filename) await removeImageIfUnused(db, images, previous);
    return requireRecipe(db, id);
  });

  app.delete<{ Params: { id: string } }>('/api/recipes/:id/image', async (req) => {
    const id = parseId(req.params.id);
    const { updated, previous } = setRecipeImage(db, id, null);
    if (!updated) throw notFound('Recipe not found');
    await removeImageIfUnused(db, images, previous);
    return requireRecipe(db, id);
  });
};
