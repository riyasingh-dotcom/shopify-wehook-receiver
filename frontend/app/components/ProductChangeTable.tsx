'use client';

import { DataTable, EmptyState } from '@shopify/polaris';

export type ProductChange = {
  id: string;
  productTitle: string;
  fieldChanged: string;
  oldValue: string;
  newValue: string;
  changedAt: string;
};

type ProductChangeTableProps = {
  changes: ProductChange[];
  isFiltered: boolean;
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function ProductChangeTable({
  changes,
  isFiltered,
}: ProductChangeTableProps) {
  if (changes.length === 0) {
    return (
      <EmptyState
        heading={
          isFiltered
            ? 'No results for this search'
            : 'No product changes recorded'
        }
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>
          {isFiltered
            ? 'Try a different search term.'
            : 'Product field changes will appear here once your store sends product webhooks.'}
        </p>
      </EmptyState>
    );
  }

  const rows = changes.map((c) => [
    c.productTitle,
    c.fieldChanged,
    c.oldValue || '—',
    c.newValue,
    formatDate(c.changedAt),
  ]);

  return (
    <DataTable
      columnContentTypes={['text', 'text', 'text', 'text', 'text']}
      headings={[
        'Product',
        'Field Changed',
        'Old Value',
        'New Value',
        'Changed At',
      ]}
      rows={rows}
      defaultSortDirection="descending"
      initialSortColumnIndex={4}
      sortable={[false, false, false, false, true]}
    />
  );
}
