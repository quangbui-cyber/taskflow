type Versioned = { familyId: string; version: number; publishedAt: unknown };
export function latestPublished<T extends Versioned>(templates: T[]): T[] {
  const current = new Map<string, T>();
  for (const template of templates) {
    if (template.publishedAt && (!current.has(template.familyId) || current.get(template.familyId)!.version < template.version)) current.set(template.familyId, template);
  }
  return [...current.values()];
}
