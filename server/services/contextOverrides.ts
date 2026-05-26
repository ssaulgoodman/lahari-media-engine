export type ContextOverrideList = boolean | string[];

export type ContextOverrides = {
  includeStyleImage?: boolean;
  // undefined = use project default style asset; null = use no style asset;
  // string = use this project asset instead of the default.
  styleAssetId?: string | null;
  includeCastRefs?: ContextOverrideList;
  excludeCastRefs?: string[];
  includeEnvironmentRefs?: ContextOverrideList;
  excludeEnvironmentRefs?: string[];
  includePreviousStoryboard?: boolean;
  includeGuideAsset?: boolean;
  includeProjectStyleDescription?: boolean;
  includeConcept?: boolean;
};

export type ContextTrace = {
  requested: ContextOverrides | null;
  included: string[];
  excluded: string[];
  replaced: string[];
};

export const emptyContextTrace = (overrides?: ContextOverrides | null): ContextTrace => ({
  requested: overrides && Object.keys(overrides).length ? overrides : null,
  included: [],
  excluded: [],
  replaced: [],
});

export const hasContextOverrides = (overrides?: ContextOverrides | null): overrides is ContextOverrides => (
  !!overrides && Object.keys(overrides).length > 0
);

const listAllows = (list: ContextOverrideList | undefined, id: string) => {
  if (list === false) return false;
  if (Array.isArray(list)) return list.includes(id);
  return true;
};

export const shouldIncludeStyleImage = (overrides?: ContextOverrides | null) => (
  overrides?.includeStyleImage !== false && overrides?.styleAssetId !== null
);

export const shouldIncludeProjectStyleDescription = (overrides?: ContextOverrides | null) => (
  overrides?.includeProjectStyleDescription !== false
);

export const shouldIncludeGuideAsset = (overrides?: ContextOverrides | null) => (
  overrides?.includeGuideAsset !== false
);

export const shouldIncludeConcept = (overrides?: ContextOverrides | null) => (
  overrides?.includeConcept !== false
);

export const shouldIncludeStoryboardRefKey = (key?: string, overrides?: ContextOverrides | null) => {
  if (!key || !overrides) return true;
  if (key === 'style') return shouldIncludeStyleImage(overrides);
  if (key === 'prev_storyboard') return overrides.includePreviousStoryboard !== false;
  if (key.startsWith('cast:')) {
    const id = key.slice('cast:'.length);
    if (!listAllows(overrides.includeCastRefs, id)) return false;
    if (overrides.excludeCastRefs?.includes(id)) return false;
  }
  if (key.startsWith('env:')) {
    const id = key.slice('env:'.length);
    if (!listAllows(overrides.includeEnvironmentRefs, id)) return false;
    if (overrides.excludeEnvironmentRefs?.includes(id)) return false;
  }
  return true;
};

export const contextTracePreview = (trace: ContextTrace) => {
  if (!trace.requested) return '';
  return JSON.stringify({
    requested: trace.requested,
    included: trace.included,
    excluded: trace.excluded,
    replaced: trace.replaced,
  });
};
