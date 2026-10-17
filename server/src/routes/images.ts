import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { notFound } from '../errors.js';
import { isValidImageFilename, type ImageStore } from '../services/images.js';

// Images are served only through this route, by validated content-hash filename.
// The data directory itself is never exposed.
export const imageRoutes: FastifyPluginAsync<{ images: ImageStore }> = async (app, { images }) => {
  app.get<{ Params: { filename: string } }>('/api/images/:filename', async (req, reply) => {
    const { filename } = req.params;
    if (!isValidImageFilename(filename) || !(await images.exists(filename))) {
      throw notFound('Image not found');
    }
    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(images.pathFor(filename)));
  });
};
