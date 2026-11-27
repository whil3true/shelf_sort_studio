import type { Board, Move } from '../../src/game/Board.ts';
import { EndlessSession } from '../../src/game/EndlessSession.ts';

function decode(encoded: string): Move[] {
  return encoded.split(' ').map(value => {
    const [source, from, target, to] = [...value].map(Number);
    return { from: { shelf: source, slot: from }, to: { shelf: target, slot: to } };
  });
}

export const supplySeed = 3;
export const supplyPath = decode('2032 4000 5240 3142');
export const moveSupplySeed = 0;
export const moveSupplyPath = decode('3211 2232 3200 1021 2032 0110');

export const lossSeed = 227;
export const lossPath = decode('4110 0252 0140 4202 5032 4050 5222 2052 2201 2100');

export const clearForRestock: Move = { from: { shelf: 1, slot: 0 }, to: { shelf: 0, slot: 2 } };

export function restockSave() {
  const start = EndlessSession.start(1).snapshot();
  const board: Board = [
    { front: ['tea', 'tea', null], stock: [] },
    { front: ['tea', 'jam', null], stock: [['jam', null, null]] },
    { front: ['cocoa', null, null], stock: [['cocoa', null, null]] },
    { front: ['pear', null, null], stock: [['pear', 'pear', null]] },
    { front: ['cocoa', null, null], stock: [] },
    { front: ['jam', null, null], stock: [] },
  ];
  return { ...start, position: { ...start.position, board, moves: 1, matches: 1 } };
}
