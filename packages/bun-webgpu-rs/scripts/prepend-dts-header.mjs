import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const header = readFileSync(join(root, 'dts-header.ts'), 'utf-8');
const dts = readFileSync(join(root, 'index.d.ts'), 'utf-8');
writeFileSync(join(root, 'index.d.ts'), header + '\n' + dts);
