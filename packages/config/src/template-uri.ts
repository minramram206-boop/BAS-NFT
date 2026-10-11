/** Longest prefix the on-chain `ApprovedTemplate` account accepts. */
export const MAX_TEMPLATE_URI_PREFIX_LENGTH = 200;

/**
 * Same rule as `ApprovedTemplate::is_valid_uri_prefix` in the program: an
 * HTTPS prefix ending in `/templates/{templateId}/`, printable ASCII only,
 * without credentials, query, fragment, backslash or `..`.
 */
export function isValidTemplateUriPrefix(value: string, templateId: number): boolean {
  const requiredSuffix = `/templates/${templateId}/`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname.length > 0 &&
    parsed.username.length === 0 &&
    parsed.password.length === 0 &&
    parsed.search.length === 0 &&
    parsed.hash.length === 0 &&
    parsed.pathname.endsWith(requiredSuffix) &&
    value.endsWith(requiredSuffix) &&
    value.length <= MAX_TEMPLATE_URI_PREFIX_LENGTH &&
    /^[\x21-\x7E]+$/.test(value) &&
    !value.includes('..') &&
    !/[?#\\]/.test(value)
  );
}
