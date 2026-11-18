import { describe, expect, test } from 'bun:test';
import { askCoachRequestSchema, chatRequestSchema, validateInput } from './schemas';

describe('askCoachRequestSchema', () => {
  test('a request without messages is a 400-style validation error, not a crash', () => {
    expect(validateInput(askCoachRequestSchema, {}).success).toBe(false);
    expect(validateInput(askCoachRequestSchema, { messages: [] }).success).toBe(false);
  });

  test('needs a non-empty message from the athlete', () => {
    expect(validateInput(askCoachRequestSchema, { messages: [{ role: 'assistant', content: 'Hi' }] }).success).toBe(false);
    expect(validateInput(askCoachRequestSchema, { messages: [{ role: 'user', content: '   ' }] }).success).toBe(false);
    expect(validateInput(askCoachRequestSchema, { messages: [{ role: 'user', content: 'How was my week?' }] }).success).toBe(true);
  });

  test('sessionId must be a uuid', () => {
    const messages = [{ role: 'user', content: 'Hi' }];
    expect(validateInput(askCoachRequestSchema, { messages, sessionId: 'abc' }).success).toBe(false);
    expect(validateInput(askCoachRequestSchema, { messages, sessionId: '6f1c1e2a-1d2b-4c3d-8e4f-5a6b7c8d9e0f' }).success).toBe(true);
  });

  test("Grocky's plan review still validates with no messages", () => {
    expect(validateInput(chatRequestSchema, { reviewPlan: true }).success).toBe(true);
  });
});
