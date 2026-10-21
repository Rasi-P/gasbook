import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'bun:test';
import { DEFAULT_IMAGE_WEIGHTS, SUPPORTED_CYLINDER_WEIGHTS, defaultCylinderImageFile } from '../src/lib/cylinderImages';

// The one folder both apps load SABCO defaults from (served by the backend at /static/cylinders/).
const FOLDER = join(import.meta.dir, '../../backend/core/static/cylinders');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

it('every file in the defaults folder is a sabco-<kg>kg.png the apps actually request', () => {
  const files = readdirSync(FOLDER).filter((name) => !name.startsWith('.'));
  for (const name of files) {
    const kg = Number(/^sabco-(\d+)kg\.png$/.exec(name)?.[1]);
    expect(`${name} → ${DEFAULT_IMAGE_WEIGHTS.includes(kg) ? 'used' : 'never requested: misnamed, or add its weight to DEFAULT_IMAGE_WEIGHTS'}`).toBe(`${name} → used`);
    expect([...readFileSync(join(FOLDER, name)).subarray(0, 8)]).toEqual(PNG);
  }
});

for (const kg of SUPPORTED_CYLINDER_WEIGHTS) {
  const file = defaultCylinderImageFile(kg);
  // A weight whose file is not added yet shows as skipped; the apps show the generic cylinder for it meanwhile.
  it.skipIf(!existsSync(join(FOLDER, file)))(`${file} is in backend/core/static/cylinders`, () => {
    expect([...readFileSync(join(FOLDER, file)).subarray(0, 8)]).toEqual(PNG);
  });
}
