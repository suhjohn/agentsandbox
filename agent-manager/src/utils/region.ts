export type Region = string | readonly string[];

export const DEFAULT_REGION = "us-west-2";

export function parseRegionText(region: string | null | undefined): Region | undefined {
  if (!region) return undefined;
  const trimmed = region.trim();
  if (trimmed.length === 0) return undefined;
  if (!trimmed.startsWith("[")) return trimmed;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return undefined;
    if (!parsed.every((value) => typeof value === "string" && value.trim().length > 0)) {
      return undefined;
    }
    return parsed as readonly string[];
  } catch {
    return undefined;
  }
}

export function serializeRegion(region: Region | null | undefined): string | null {
  if (region == null) return null;
  if (typeof region === "string") return region;
  return JSON.stringify(region);
}

