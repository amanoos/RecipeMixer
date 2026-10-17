/**
 * An error whose message is safe to show to API clients.
 * The Fastify error handler passes the message through for any status below 500.
 */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, message);
export const notFound = (message = 'Not Found'): HttpError => new HttpError(404, message);
export const payloadTooLarge = (message: string): HttpError => new HttpError(413, message);
export const unsupportedMediaType = (message: string): HttpError => new HttpError(415, message);
