import type { Move } from '../../src/game/Board.ts';

function decode(encoded: string): Move[] {
  return encoded.split(' ').map(value => {
    const [source, from, target, to] = [...value].map(Number);
    return { from: { shelf: source, slot: from }, to: { shelf: target, slot: to } };
  });
}

export const supplySeed = 3;
export const supplyPath = decode('2032 4000 5240 3142');
export const deferredSupplySeed = 0;
export const deferredSupplyPath = decode('3011 5130 4231 1251 2052 2240');
export const moveSupplySeed = 1;
export const moveSupplyPath = decode('1252 4010 0212 1040 2241 3021');

export const lossSeed = 227;
export const lossPath = decode('4110 0252 0140 4202 5032 4050 5222 2052 2201 2100');
