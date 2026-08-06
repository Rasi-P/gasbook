export const PHONE_LENGTH = 10;

export const PHONE_LENGTH_MESSAGE = `Phone number must be exactly ${PHONE_LENGTH} digits.`;
export const PHONE_DIGITS_MESSAGE = 'Phone number must contain only digits.';

/** Strip anything that is not 0-9 and cap at 10 digits. */
export function sanitizePhone(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, PHONE_LENGTH);
}

export function isValidPhone(phone: string): boolean {
  return /^[0-9]{10}$/.test(phone);
}

/** Inline error for a partially typed number; empty string when fine. */
export function phoneError(phone: string): string {
  if (!phone) return '';
  return isValidPhone(phone) ? '' : PHONE_LENGTH_MESSAGE;
}
