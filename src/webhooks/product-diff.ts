export type FieldChange = {
  field: string;
  oldValue: string | null;
  newValue: string;
};

const TRACKED_SCALAR_FIELDS = ['title', 'status', 'published_at'] as const;
type TrackedScalarField = (typeof TRACKED_SCALAR_FIELDS)[number];

// ── helpers ───────────────────────────────────────────────────────────────────

function toRecord(val: unknown): Record<string, unknown> | null {
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

function toRecordArray(val: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(val)) return [];
  return val.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

function getString(
  obj: Record<string, unknown>,
  key: TrackedScalarField | 'id' | 'price',
): string | null {
  const val = obj[key];
  return typeof val === 'string' ? val : null;
}

function getStringId(obj: Record<string, unknown>): string | null {
  const val = obj['id'];
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  return null;
}

// ── main function ─────────────────────────────────────────────────────────────

export function detectProductChanges(
  previousProduct: unknown,
  updatedPayload: unknown,
): FieldChange[] {
  const updated = toRecord(updatedPayload);
  if (updated === null) return [];

  if (previousProduct === null || previousProduct === undefined) {
    return [{ field: 'created', oldValue: null, newValue: 'new product' }];
  }

  const previous = toRecord(previousProduct);
  if (previous === null) return [];

  const changes: FieldChange[] = [];

  // Scalar fields
  for (const field of TRACKED_SCALAR_FIELDS) {
    const oldValue = getString(previous, field);
    const newValue = getString(updated, field);
    // newValue must be string (per return type); skip if null (e.g. published_at cleared)
    if (newValue !== null && newValue !== oldValue) {
      changes.push({ field, oldValue, newValue });
    }
  }

  // Variant prices
  const prevVariants = toRecordArray(previous['variants']);
  const newVariants = toRecordArray(updated['variants']);

  const prevPriceById = new Map<string, string>();
  for (const variant of prevVariants) {
    const id = getStringId(variant);
    const price = getString(variant, 'price');
    if (id !== null && price !== null) {
      prevPriceById.set(id, price);
    }
  }

  for (const variant of newVariants) {
    const id = getStringId(variant);
    const price = getString(variant, 'price');
    if (id === null || price === null) continue;

    const oldPrice = prevPriceById.get(id) ?? null;
    if (oldPrice !== price) {
      changes.push({
        field: `variant:${id}:price`,
        oldValue: oldPrice,
        newValue: price,
      });
    }
  }

  return changes;
}
