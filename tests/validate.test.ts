import { Request, Response } from 'express';
import { validate } from '../src/middleware/validate';
import { createTaskSchema, listTasksSchema } from '../src/validators/task.validator';
import { captureSchema, updatePreferencesSchema } from '../src/validators/ai.validator';

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: any };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; }) as any;
  res.json = vi.fn((body: any) => { res.body = body; return res; }) as any;
  return res;
}

function run(schema: Parameters<typeof validate>[0], req: Partial<Request>) {
  const full = { body: {}, query: {}, params: {}, ...req } as Request;
  const res = mockRes();
  const next = vi.fn();
  validate(schema)(full, res, next);
  return { req: full, res, next };
}

describe('validate middleware', () => {
  it('rejects an invalid body with field-level errors', () => {
    const { res, next } = run(createTaskSchema, { body: { title: '' } });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('title');
  });

  it('applies defaults and coercion, then calls next', () => {
    const { req, next } = run(listTasksSchema, { query: { page: '2', overdue: 'true' } as any });

    expect(next).toHaveBeenCalledOnce();
    expect(req.query).toMatchObject({ page: 2, limit: 20, overdue: true, sortBy: 'dueDate', sortOrder: 'asc' });
  });

  it('accepts local and ISO due dates, rejects nonsense', () => {
    expect(run(createTaskSchema, { body: { title: 'a', dueDate: '2026-11-09' } }).next).toHaveBeenCalled();
    expect(run(createTaskSchema, { body: { title: 'a', dueDate: '2026-11-09T15:30' } }).next).toHaveBeenCalled();
    expect(run(createTaskSchema, { body: { title: 'a', dueDate: '2026-11-09T15:30:00Z' } }).next).toHaveBeenCalled();
    expect(run(createTaskSchema, { body: { title: 'a', dueDate: 'next tuesday' } }).res.statusCode).toBe(400);
  });

  it('requires capture input', () => {
    expect(run(captureSchema, { body: { input: ' ' } }).res.statusCode).toBe(400);
  });

  it('rejects unknown timezones and out-of-range project weights', () => {
    expect(run(updatePreferencesSchema, { body: { timezone: 'Mars/Olympus' } }).res.statusCode).toBe(400);
    expect(run(updatePreferencesSchema, { body: { projectWeights: { p1: 5 } } }).res.statusCode).toBe(400);
    expect(run(updatePreferencesSchema, { body: { timezone: 'Africa/Lagos', projectWeights: { p1: 1.5 } } }).next)
      .toHaveBeenCalled();
  });
});
