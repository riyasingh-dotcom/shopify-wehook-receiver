import { detectProductChanges, type FieldChange } from './product-diff';

const baseProduct = {
  title: 'Snowboard',
  status: 'active',
  published_at: '2024-01-01T00:00:00Z',
  variants: [
    { id: 1, price: '99.00' },
    { id: 2, price: '149.00' },
  ],
};

describe('detectProductChanges', () => {
  describe('when nothing has changed', () => {
    it('returns an empty array', () => {
      const result = detectProductChanges(baseProduct, { ...baseProduct });
      expect(result).toEqual([]);
    });
  });

  describe('when previousProduct is null', () => {
    it('returns a single "created" entry with null oldValue', () => {
      const result = detectProductChanges(null, baseProduct);
      expect(result).toEqual<FieldChange[]>([
        { field: 'created', oldValue: null, newValue: 'new product' },
      ]);
    });
  });

  describe('when the title changes', () => {
    it('returns one entry with the old and new title', () => {
      const updated = { ...baseProduct, title: 'New Title' };
      const result = detectProductChanges(
        { ...baseProduct, title: 'Old Title' },
        updated,
      );
      expect(result).toEqual<FieldChange[]>([
        { field: 'title', oldValue: 'Old Title', newValue: 'New Title' },
      ]);
    });
  });

  describe('when the status changes', () => {
    it('returns one entry with the old and new status', () => {
      const previous = { ...baseProduct, status: 'active' };
      const updated = { ...baseProduct, status: 'draft' };
      const result = detectProductChanges(previous, updated);
      expect(result).toEqual<FieldChange[]>([
        { field: 'status', oldValue: 'active', newValue: 'draft' },
      ]);
    });
  });

  describe('when a variant price changes', () => {
    it('returns one entry for the changed variant with the field key "variant:<id>:price"', () => {
      const previous = {
        ...baseProduct,
        variants: [{ id: 1, price: '99.00' }],
      };
      const updated = {
        ...baseProduct,
        variants: [{ id: 1, price: '149.00' }],
      };
      const result = detectProductChanges(previous, updated);
      expect(result).toEqual<FieldChange[]>([
        { field: 'variant:1:price', oldValue: '99.00', newValue: '149.00' },
      ]);
    });
  });

  describe('when title and a variant price both change simultaneously', () => {
    it('returns one entry for each changed field', () => {
      const previous = {
        ...baseProduct,
        title: 'Old Title',
        variants: [{ id: 1, price: '99.00' }],
      };
      const updated = {
        ...baseProduct,
        title: 'New Title',
        variants: [{ id: 1, price: '199.00' }],
      };
      const result = detectProductChanges(previous, updated);
      expect(result).toEqual<FieldChange[]>([
        { field: 'title', oldValue: 'Old Title', newValue: 'New Title' },
        { field: 'variant:1:price', oldValue: '99.00', newValue: '199.00' },
      ]);
    });
  });
});
