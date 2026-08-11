export function cleanStr(str: string) {
  // eslint-disable-next-line no-irregular-whitespace
  return str.replace(/[・() 　]|\*\d/g, '');
}
export function removeFromEnd(str: string, stringsToRemove: string[]): string {
  for (const stringToRemove of stringsToRemove) {
    if (str.endsWith(stringToRemove)) {
      return str.slice(0, -stringToRemove.length);
    }
  }
  return str;
}

/**
 * Collapses runs of whitespace (including stray tabs/newlines from the wiki
 * markup) into single spaces and trims the result.
 */
export function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}
