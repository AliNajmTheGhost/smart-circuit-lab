import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { catalogJson } from '../src/model/catalog-export';

it('catalog/parts.json matches the part library (run `npm run catalog` after editing library.ts)', () => {
  const onDisk = readFileSync(new URL('../catalog/parts.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  expect(onDisk).toBe(catalogJson());
});
