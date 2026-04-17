/**
 * Reference design-system loader.
 *
 * Each JSON file in this directory is a hand-picked, normalized slice of a
 * public design system (names, licenses, and original sources are recorded
 * inside each file). Values are primitives: font sizes in px, spacing in px,
 * radius in px, colors as lowercase #rrggbb hex.
 */
import material3 from "./material3.json";
import uswds from "./uswds.json";
import govuk from "./govuk.json";
import carbon from "./carbon.json";

export type DesignSystemName = "material3" | "uswds" | "govuk" | "carbon";

export interface DesignSystemRef {
  /** Human-readable name, e.g. "Material 3". */
  name: string;
  /** SPDX license identifier for the original system (not this file). */
  license: string;
  /** URL / attribution for where the token values came from. */
  source: string;
  /** Spacing base unit in px — spacing values should be multiples of this. */
  baseUnit: number;
  tokens: {
    fontSizes: number[];
    spacing: number[];
    radius: number[];
    colors: string[];
  };
}

const REGISTRY: Record<DesignSystemName, DesignSystemRef> = {
  material3: material3 as DesignSystemRef,
  uswds: uswds as DesignSystemRef,
  govuk: govuk as DesignSystemRef,
  carbon: carbon as DesignSystemRef,
};

export function loadSystem(name: DesignSystemName): DesignSystemRef {
  const ref = REGISTRY[name];
  if (!ref) {
    throw new Error(
      `Unknown design system "${name}". Expected one of: ${Object.keys(REGISTRY).join(", ")}`
    );
  }
  return ref;
}

export function listSystems(): DesignSystemName[] {
  return Object.keys(REGISTRY) as DesignSystemName[];
}
