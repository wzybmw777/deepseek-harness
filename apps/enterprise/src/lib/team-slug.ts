/** Team slug derivation and validation for the enterprise console. */

const TEAM_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/u
const TEAM_SLUG_FORMAT_ERROR = '只能使用小写字母、数字和连字符，并以字母或数字开头'

/**
 * Derive a URL-safe slug from a team name.
 * @param name - team display name.
 * @returns the derived slug, or an empty string when the name has no Latin characters.
 */
export function deriveTeamSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
}

/**
 * Normalize slug input without discarding characters the user typed.
 * @param value - raw input value.
 * @returns lower-case input with whitespace represented by hyphens.
 */
export function normalizeTeamSlugInput(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, '-')
}

/**
 * Report a slug that cannot be saved.
 * @param slug - trimmed slug value.
 * @returns a localized format error, or undefined for an empty or valid slug.
 */
export function teamSlugError(slug: string): string | undefined {
  return slug === '' || TEAM_SLUG_PATTERN.test(slug) ? undefined : TEAM_SLUG_FORMAT_ERROR
}
