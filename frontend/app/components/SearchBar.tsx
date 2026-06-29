'use client';

import { TextField } from '@shopify/polaris';

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
}: SearchBarProps) {
  return (
    <TextField
      label="Search"
      labelHidden
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoComplete="off"
      clearButton
      onClearButtonClick={() => onChange('')}
    />
  );
}
