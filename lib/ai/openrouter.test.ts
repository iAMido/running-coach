/**
 * Run with `bun test`.
 *
 * Opus 5.5 and Grok 4.7 reason by default and it cannot be disabled; the
 * thinking tokens count against max_tokens. These pin the rule that thinking
 * gets its own headroom so every maxTokens in the app keeps meaning "visible
 * answer length".
 */
import { expect, test } from 'bun:test';
import { tokenFields } from '@/lib/ai/openrouter';
import { MODEL_FOR, REASONING_FOR } from '@/lib/ai/model-registry';

test('non-reasoning models are sent exactly the requested max_tokens', () => {
  expect(tokenFields('anthropic/claude-haiku-4.5', 120)).toEqual({ max_tokens: 120 });
});

test('adaptive thinkers (Sonnet 5) have thinking OFF unless a task asks for it', () => {
  expect(tokenFields('anthropic/claude-sonnet-5', 1500)).toEqual({ max_tokens: 1500, reasoning: { enabled: false } });
  expect(tokenFields('anthropic/claude-sonnet-5', 1500, 0)).toEqual({ max_tokens: 1500, reasoning: { enabled: false } });
  expect(tokenFields('anthropic/claude-sonnet-5', 1500, 2000).max_tokens).toBe(3500);
});

test('mandatory thinkers cannot be switched off — a 0 budget still gets headroom', () => {
  // Sending { enabled: false } to Opus 5.5 is a hard API error.
  const f = tokenFields('anthropic/claude-opus-5.5', 500, 0);
  expect(f.reasoning).toEqual({ max_tokens: 2048, exclude: true });
  expect(f.max_tokens).toBe(2548);
});

test('mandatory-reasoning models get thinking headroom ON TOP of the answer budget', () => {
  const f = tokenFields('anthropic/claude-opus-5.5', 300);
  expect(f.reasoning).toEqual({ max_tokens: 2048, exclude: true });
  expect(f.max_tokens).toBe(300 + 2048);
});

test('Grok 4.7 is steered by effort (it ignores token budgets), still with headroom', () => {
  const f = tokenFields('x-ai/grok-4.7', 1500);
  expect(f.reasoning).toEqual({ effort: 'low', exclude: true });
  expect(f.max_tokens).toBe(1500 + 4000);
});

test('a task budget overrides the default, never below the 1,024 minimum', () => {
  expect(tokenFields('anthropic/claude-opus-5.5', 2000, 4000).max_tokens).toBe(6000);
  expect(tokenFields('anthropic/claude-opus-5.5', 2000, 100).reasoning).toEqual({ max_tokens: 1024, exclude: true });
});

test('every task routed to a reasoning model is covered', () => {
  // If a registry model thinks, its calls must not be sized as if it did not.
  for (const model of Object.values(MODEL_FOR)) {
    if (model.includes('opus-5') || model.includes('grok-4.7')) {
      expect(tokenFields(model, 100).reasoning).toBeDefined();
    }
  }
  expect(REASONING_FOR.weekly_review).toBeGreaterThanOrEqual(1024);
});

test('plan generation does not switch thinking on for a model that does not need it', () => {
  // Opus 4.7 does not reason unless asked; a budget here would push a ~150 s
  // plan toward the 300 s function limit (see model-registry.ts).
  const f = tokenFields(MODEL_FOR.plan_generation, 28_000, REASONING_FOR.plan_generation);
  expect(f).toEqual({ max_tokens: 28_000 });
});
