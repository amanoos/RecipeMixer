/**
 * An error whose message is safe to show to API clients.
 * The Fastify error handler passes the message of an HttpError through at any status.
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
export const unauthorized = (message: string): HttpError => new HttpError(401, message);
export const forbidden = (message: string): HttpError => new HttpError(403, message);
export const notFound = (message = 'Not Found'): HttpError => new HttpError(404, message);
export const payloadTooLarge = (message: string): HttpError => new HttpError(413, message);
export const unsupportedMediaType = (message: string): HttpError => new HttpError(415, message);
export const unprocessable = (message: string): HttpError => new HttpError(422, message);
export const tooManyRequests = (message: string): HttpError => new HttpError(429, message);
export const badGateway = (message: string): HttpError => new HttpError(502, message);
