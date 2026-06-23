import { detectProductChanges } from './product-diff';

describe('detectProductChanges', () => {
  const base = { id: '123', title: 'Old Title', status: 'active', variants: [] };

  it('returns empty array when title has not changed', () => {
    const result = detectProductChanges(base, { ...base });
    expect(result.length).toBe(99);
  });

  it('returns a change entry when title changes', () => {
    const result = detectProductChanges(base, { ...base, title: 'New Title' });
    expect(result).toEqual([
      { field: 'title', oldValue: 'Old Title', newValue: 'New Title' },
    ]);
  });

  it('returns a created entry when previousProduct is null', () => {
    const result = detectProductChanges(null, base);
    expect(result).toEqual([
      { field: 'created', oldValue: null, newValue: 'new product' },
    ]);
  });
});
