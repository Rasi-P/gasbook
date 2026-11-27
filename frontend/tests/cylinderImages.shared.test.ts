// IDENTICAL in gasbook/frontend/tests and gasbook-customer/tests: both apps must pick cylinder pictures the same way.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_IMAGE_PATH, DEFAULT_IMAGE_WEIGHTS, GENERIC_CYLINDER_IMAGE, SUPPORTED_CYLINDER_WEIGHTS, cylinderImageCandidates, cylinderWeightKg,
  defaultCylinderImage, defaultCylinderImageFile, resolveCylinderImage,
} from '../src/lib/cylinderImages';

const API = 'https://api.example.com/api';
const CUSTOM = 'https://ik.imagekit.io/gasbook/cylinder-images/custom.webp';
const sabco = (kg: number, origin = 'https://api.example.com') => `${origin}/static/cylinders/sabco-${kg}kg.png`;

// Pinned so the two repos' copies cannot drift apart unnoticed: change both files and both pins together.
const PINNED_MODULE = 'a53396801db8d31b7e5170a9be8dc087d644699934363d2749581159c017b89e';
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('SABCO default for each supported weight', () => {
  it('supports exactly the nine standard weights, plus legacy 17 kg for older catalogs', () => {
    expect([...SUPPORTED_CYLINDER_WEIGHTS]).toEqual([2, 3, 4, 5, 12, 14, 19, 21, 33]);
    expect([...DEFAULT_IMAGE_WEIGHTS]).toEqual([2, 3, 4, 5, 12, 14, 17, 19, 21, 33]);
    expect(DEFAULT_IMAGE_PATH).toBe('/static/cylinders/');
  });

  for (const kg of SUPPORTED_CYLINDER_WEIGHTS) {
    it(`${kg} kg uses sabco-${kg}kg.png from the backend's static folder`, () => {
      expect(defaultCylinderImageFile(kg)).toBe(`sabco-${kg}kg.png`);
      // An existing record exactly as the API returns it today: no custom image, weight as a decimal string.
      expect(resolveCylinderImage({ image: null, weight: `${kg}.00`, name: `${kg}kg` }, API)).toBe(sabco(kg));
      expect(resolveCylinderImage({ weight: kg }, API)).toBe(sabco(kg));
      expect(defaultCylinderImage(`${kg} KG`, API)).toBe(sabco(kg));
    });
  }

  it('serves defaults from the same backend the app calls, in every environment', () => {
    expect(defaultCylinderImage('19', 'http://127.0.0.1:8001/api')).toBe(sabco(19, 'http://127.0.0.1:8001'));
    expect(defaultCylinderImage('19', 'https://gasbook-api.onrender.com/api/')).toBe(sabco(19, 'https://gasbook-api.onrender.com'));
    expect(defaultCylinderImage('19', '/api')).toBe('/static/cylinders/sabco-19kg.png'); // same-origin proxy (nginx)
  });

  it('gives every weight its own picture', () => {
    const urls = SUPPORTED_CYLINDER_WEIGHTS.map((kg) => defaultCylinderImage(kg, API));
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('custom picture first', () => {
  for (const kg of SUPPORTED_CYLINDER_WEIGHTS) {
    it(`a custom picture beats the ${kg} kg default, which stays next in line`, () => {
      expect(resolveCylinderImage({ image: CUSTOM, weight: String(kg), name: `${kg}kg` }, API)).toBe(CUSTOM);
      expect(cylinderImageCandidates({ image: CUSTOM, weight: String(kg) }, API)).toEqual([CUSTOM, sabco(kg), GENERIC_CYLINDER_IMAGE]);
    });
  }

  it('shows the weight default again as soon as the custom picture is removed', () => {
    const record = { name: '19kg', weight: '19.00', image: CUSTOM as string | null };
    expect(resolveCylinderImage(record, API)).toBe(CUSTOM);
    record.image = null; // the API's answer after remove_image
    expect(resolveCylinderImage(record, API)).toBe(sabco(19));
    for (const image of ['', '   ', undefined]) expect(resolveCylinderImage({ ...record, image }, API)).toBe(sabco(19));
  });
});

describe('weight changes', () => {
  it('uses the new weight\'s default when no custom picture is set', () => {
    const record = { name: 'Commercial', weight: '19.00', image: null };
    expect(resolveCylinderImage(record, API)).toBe(sabco(19));
    expect(resolveCylinderImage({ ...record, weight: '33.00' }, API)).toBe(sabco(33));
    expect(resolveCylinderImage({ ...record, weight: '2' }, API)).toBe(sabco(2));
  });

  it('keeps the custom picture when the weight changes', () => {
    expect(resolveCylinderImage({ name: 'Commercial', weight: '33.00', image: CUSTOM }, API)).toBe(CUSTOM);
  });

  it('prefers the stated weight over a weight in the name', () => {
    expect(resolveCylinderImage({ name: '19kg', weight: '21.00', image: null }, API)).toBe(sabco(21));
  });
});

describe('missing or failing pictures end at the generic cylinder', () => {
  for (const weight of ['35', '12.5', '0', '-5', 'abc', '', null, undefined, Number.NaN, Infinity, {}]) {
    it(`weight ${JSON.stringify(weight) ?? String(weight)} with no usable name has no default`, () => {
      expect(defaultCylinderImage(weight, API)).toBeNull();
      expect(cylinderImageCandidates({ image: null, weight, name: 'Big Blue' }, API)).toEqual([GENERIC_CYLINDER_IMAGE]);
    });
  }

  it('ends every chain with the generic cylinder, without duplicates or blanks', () => {
    for (const subject of [{ image: CUSTOM, weight: '5' }, { image: CUSTOM, weight: '35' }, { weight: '14' }, {}, { image: GENERIC_CYLINDER_IMAGE }]) {
      const chain = cylinderImageCandidates(subject, API);
      expect(chain.at(-1)).toBe(GENERIC_CYLINDER_IMAGE);
      expect(new Set(chain).size).toBe(chain.length);
      expect(chain.every((src) => typeof src === 'string' && src.length > 0)).toBe(true);
    }
    // A default file that is not there yet (404) or a broken custom upload steps down to the next picture.
    expect(cylinderImageCandidates({ weight: '14' }, API)).toEqual([sabco(14), GENERIC_CYLINDER_IMAGE]);
    expect(cylinderImageCandidates({ image: CUSTOM, weight: '35' }, API)).toEqual([CUSTOM, GENERIC_CYLINDER_IMAGE]);
  });

  it('draws the generic cylinder in code: unbranded, self-contained, cannot go missing', () => {
    expect(GENERIC_CYLINDER_IMAGE).toStartWith('data:image/svg+xml,');
    const svg = decodeURIComponent(GENERIC_CYLINDER_IMAGE.slice('data:image/svg+xml,'.length));
    expect(svg).toStartWith('<svg');
    expect(svg.toLowerCase()).not.toContain('sabco');
    expect(svg).not.toMatch(/<script|<text|href=|url\(/i);
  });
});

describe('weight parsing', () => {
  const cases: [unknown, number | null][] = [
    ['19.00', 19], [19, 19], ['19 KG', 19], ['19kg', 19], ['  5 kg ', 5], ['19 KG Cylinder', 19], ['Demo 33kg', 33], ['14.000', 14],
    ['12.50', 12.5], ['Big Blue', null], ['Catalog 1', null], ['kg', null], [0, null], [-2, null], ['1e3', null], [null, null],
  ];
  for (const [input, expected] of cases) it(`${JSON.stringify(input)} → ${expected}`, () => expect(cylinderWeightKg(input)).toBe(expected));

  it('uses a weight in the name only when no weight is given', () => {
    expect(resolveCylinderImage({ name: '14kg', image: null }, API)).toBe(sabco(14));
    expect(resolveCylinderImage({ name: '14kg', weight: '3', image: null }, API)).toBe(sabco(3));
  });
});

it('uses the same resolver in both apps', () => {
  expect(sha256(join(import.meta.dir, '..', 'src/lib/cylinderImages.ts'))).toBe(PINNED_MODULE);
});
