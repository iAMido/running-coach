import { describe, expect, test } from 'bun:test';
import { isEmailAllowed, parseAllowedEmails } from './allowlist';
import { isCronAuthorized } from './cron';

describe('isEmailAllowed', () => {
  test('admits a listed email, case- and space-insensitive', () => {
    expect(isEmailAllowed('Runner@Example.com', ' runner@example.com , other@example.com')).toBe(true);
    expect(isEmailAllowed('other@example.com', 'runner@example.com,other@example.com')).toBe(true);
  });

  test('refuses an unlisted email', () => {
    expect(isEmailAllowed('stranger@example.com', 'runner@example.com')).toBe(false);
  });

  test('fails closed when the list is unset or empty', () => {
    expect(isEmailAllowed('runner@example.com', undefined)).toBe(false);
    expect(isEmailAllowed('runner@example.com', '')).toBe(false);
    expect(isEmailAllowed('runner@example.com', ' , ')).toBe(false);
  });

  test('refuses a session with no email', () => {
    expect(isEmailAllowed(null, 'runner@example.com')).toBe(false);
    expect(isEmailAllowed(undefined, 'runner@example.com')).toBe(false);
  });

  test('parse drops blanks', () => {
    expect([...parseAllowedEmails('a@x.com,, B@x.com ')]).toEqual(['a@x.com', 'b@x.com']);
  });
});

describe('isCronAuthorized', () => {
  test('accepts the right bearer', () => {
    expect(isCronAuthorized('Bearer s3cret', 's3cret')).toBe(true);
  });

  test('refuses a wrong or missing header', () => {
    expect(isCronAuthorized('Bearer nope', 's3cret')).toBe(false);
    expect(isCronAuthorized('s3cret', 's3cret')).toBe(false);
    expect(isCronAuthorized(null, 's3cret')).toBe(false);
  });

  test('a missing secret refuses everything, including "Bearer undefined"', () => {
    expect(isCronAuthorized('Bearer undefined', undefined)).toBe(false);
    expect(isCronAuthorized('Bearer ', '')).toBe(false);
  });
});
