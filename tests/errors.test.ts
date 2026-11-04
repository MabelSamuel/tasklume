import { AppError, NotFoundError, ValidationError } from '../src/lib/errors';

describe('AppError hierarchy', () => {
  it('carries status code and machine-readable code', () => {
    const err = new NotFoundError('Task not found');

    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Task not found');
    expect(err.isOperational).toBe(true);
  });

  it('keeps validation details', () => {
    const details = [{ field: 'title', message: 'Required' }];
    const err = new ValidationError('Bad input', details);

    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual(details);
  });
});
