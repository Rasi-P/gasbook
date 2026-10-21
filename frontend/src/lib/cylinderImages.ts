/**
 * Which picture to show for a cylinder type — ONE rule for every screen in both GasBook apps.
 *
 *   1. the custom image an admin uploaded for that type (the API's `image`), else
 *   2. the SABCO default for its weight, `sabco-<kg>kg.png`, else
 *   3. a generic, unbranded cylinder (also shown when a picture is missing or fails to load).
 *
 * The defaults live in ONE folder, gasbook/backend/core/static/cylinders/, and are served by the backend both apps
 * already talk to, at <backend>/static/cylinders/. They are static files: never uploaded to media storage, never
 * copied per record, never touched when a custom image is removed. Existing types use them with no migration, and
 * a weight change picks the new weight's default at once. <CylinderImage> walks this list when a picture fails.
 *
 * This file is kept IDENTICAL in gasbook/frontend and gasbook-customer (tests/cylinderImages.shared.test.ts pins it).
 */

/** The weights GasBook sells; each has a default picture named `sabco-<kg>kg.png`. */
export const SUPPORTED_CYLINDER_WEIGHTS = [2, 3, 4, 5, 12, 14, 19, 21, 33] as const;

/** Weights to look up a default for: the nine above plus 17 kg, whose SABCO picture older catalogs already used. */
export const DEFAULT_IMAGE_WEIGHTS: readonly number[] = Object.freeze([2, 3, 4, 5, 12, 14, 17, 19, 21, 33]);

/** Where the backend serves the default pictures (Django static files, see gasbook/backend/core/static/cylinders/). */
export const DEFAULT_IMAGE_PATH = '/static/cylinders/';

export const defaultCylinderImageFile = (kg: number) => `sabco-${kg}kg.png`;

// Drawn in code, not an asset: it cannot go missing or fail to load. Deliberately carries no brand.
const GENERIC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 200">'
  + '<path d="M40 30V8h40v22" fill="none" stroke="#94a3b8" stroke-width="7" stroke-linejoin="round"/>'
  + '<rect x="54" y="18" width="12" height="16" rx="2" fill="#a8a29e"/>'
  + '<rect x="14" y="30" width="92" height="150" rx="30" fill="#cbd5e1"/>'
  + '<rect x="14" y="98" width="92" height="3" fill="#94a3b8"/>'
  + '<rect x="24" y="176" width="72" height="20" rx="4" fill="#94a3b8"/></svg>';

/** Unbranded cylinder for unknown weights, missing defaults and pictures that fail to load. */
export const GENERIC_CYLINDER_IMAGE = `data:image/svg+xml,${encodeURIComponent(GENERIC_SVG)}`;

/** A weight in kg from an API decimal ("19.00"), a number, or a label ("19 KG", "19kg"); null when there is none. */
export function cylinderWeightKg(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:kg)?$/i) ?? value.match(/(\d+(?:\.\d+)?)\s*kg\b/i);
  return match ? cylinderWeightKg(Number(match[1])) : null;
}

/** The backend origin the defaults are served from, taken from the app's API base URL (".../api"). */
function staticOrigin(apiBaseUrl: string): string {
  try { return new URL(apiBaseUrl).origin; } catch { return ''; } // a relative base means the same origin
}

/** URL of the SABCO default for a weight, or null when that weight has none. */
export function defaultCylinderImage(weight: unknown, apiBaseUrl: string): string | null {
  const kg = cylinderWeightKg(weight);
  if (kg === null || !DEFAULT_IMAGE_WEIGHTS.includes(kg)) return null;
  return `${staticOrigin(apiBaseUrl)}${DEFAULT_IMAGE_PATH}${defaultCylinderImageFile(kg)}`;
}

/** What is known about a cylinder type where it is shown. `name` is only used when no weight is given. */
export type CylinderImageSubject = { image?: string | null; weight?: unknown; name?: string | null };

/** Every picture worth trying, best first, always ending with the generic cylinder; no duplicates or blanks. */
export function cylinderImageCandidates({ image, weight, name }: CylinderImageSubject, apiBaseUrl: string): string[] {
  const custom = typeof image === 'string' && image.trim() ? image : null;
  const kg = cylinderWeightKg(weight) ?? cylinderWeightKg(name);
  return [...new Set([custom, defaultCylinderImage(kg, apiBaseUrl), GENERIC_CYLINDER_IMAGE].filter((src): src is string => Boolean(src)))];
}

/** The picture to show first (see the rule at the top of this file). */
export const resolveCylinderImage = (subject: CylinderImageSubject, apiBaseUrl: string): string =>
  cylinderImageCandidates(subject, apiBaseUrl)[0];
