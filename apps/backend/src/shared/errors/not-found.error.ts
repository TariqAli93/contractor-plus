import { AppError } from './app-error.js';

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', code = 'NOT_FOUND') {
    super(404, code, `${resource} not found`);
  }
}
