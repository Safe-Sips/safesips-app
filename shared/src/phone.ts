/**
 * Phone numbers for SOS text alerts, normalised to E.164 (+<country><number>)
 * because SMS gateways require it.
 *
 * Accepted input: "+40 722 123 456", "0040722123456", or a national number
 * with a leading 0 ("0722 123 456"), which is read as Romanian (+40) since
 * SafeSips launches in Romania. Spaces, dashes, dots and brackets are ignored.
 */

/** Country calling code assumed for national numbers starting with 0. */
export const DEFAULT_PHONE_COUNTRY_CODE = "40";

const E164 = /^\+[1-9]\d{7,14}$/;

/** Returns the E.164 form, or null if it can't be a valid phone number. */
export function normalizePhone(
  raw: string,
  defaultCountryCode: string = DEFAULT_PHONE_COUNTRY_CODE
): string | null {
  let s = raw.trim().replace(/[\s\-.()]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (!s.startsWith("+")) {
    if (!/^0\d+$/.test(s)) return null; // ambiguous without a country code
    s = `+${defaultCountryCode}${s.slice(1)}`;
  }
  return E164.test(s) ? s : null;
}
