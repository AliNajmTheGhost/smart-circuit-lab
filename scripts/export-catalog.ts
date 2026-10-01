/**
 * Writes catalog/parts.json: the electrical facts about every part (pins, parameters, hidden nodes)
 * that the Rust core needs to turn a drawing into equations. Run after changing src/model/library.ts:
 *   npx tsx scripts/export-catalog.ts
 * The test tests/catalog.test.ts fails when the file is out of date.
 */
import { writeFileSync } from 'node:fs';
import { catalogJson } from '../src/model/catalog-export';

writeFileSync(new URL('../catalog/parts.json', import.meta.url), catalogJson());
console.log('catalog/parts.json written');
