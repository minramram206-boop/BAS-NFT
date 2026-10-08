import englishCopy from './en.json';

/** The single source of public-facing English copy for the web application. */
export const MESSAGES = englishCopy;

/** Replace named tokens such as `{stat}` in authored English copy. */
export function formatMessage(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (token, key: string) => {
    const value = values[key];
    return value === undefined ? token : String(value);
  });
}
