// Hand-curated Classic boats and zeppelins for the travel network (travel.ts). Data, not code. `a` / `b` are the
// boarding spots on each side; `crossing` is the ride, `wait` the average wait for the next departure (seconds).
// Only the Tirisfal ↔ Durotar zeppelin's Tirisfal end was measured (probe 0.6.0 trip 2, build 70245, 2026-10-08);
// every `guess` spot and time is common Classic knowledge: replace them from atlas NPC spots / recorded trips.
import type { MapSpot } from './types.js';

export interface Transport {
  name: string;
  kind: 'zeppelin' | 'boat';
  a: MapSpot;
  b: MapSpot;
  crossing: number;
  wait: number;
  faction: 'Horde' | 'Alliance' | 'both';
  /** The ride (crossing / wait) and, unless overridden below, both ends. */
  confidence: 'measured' | 'guess';
  /** Per-end overrides when one end was measured and the other was not. */
  confidenceA?: 'measured' | 'guess';
  confidenceB?: 'measured' | 'guess';
}

export const TRANSPORTS: readonly Transport[] = [
  {
    name: 'Tirisfal Glades ↔ Durotar',
    kind: 'zeppelin',
    // Harlan boarded at Tirisfal 60.7, 58.8. The Durotar tower (NW of Orgrimmar's gate) is a guess: the probe saw
    // the ride arrive moving near 64.2, 12.9.
    a: { mapId: 1420, x: 60.7, y: 58.8 },
    b: { mapId: 1411, x: 50.8, y: 12.6 },
    crossing: 70,
    wait: 150,
    faction: 'Horde',
    confidence: 'measured',
    confidenceA: 'measured',
    confidenceB: 'guess',
  },
  {
    // Guess: same Tirisfal tower, the Stranglethorn platform.
    name: "Tirisfal Glades ↔ Grom'gol",
    kind: 'zeppelin',
    a: { mapId: 1420, x: 61.9, y: 59.0 },
    b: { mapId: 1434, x: 31.5, y: 29.7 },
    crossing: 90,
    wait: 150,
    faction: 'Horde',
    confidence: 'guess',
  },
  {
    // Guess: Durotar tower, the Stranglethorn platform.
    name: "Durotar ↔ Grom'gol",
    kind: 'zeppelin',
    a: { mapId: 1411, x: 50.6, y: 13.0 },
    b: { mapId: 1434, x: 31.3, y: 30.3 },
    crossing: 90,
    wait: 150,
    faction: 'Horde',
    confidence: 'guess',
  },
  {
    // Guess: Booty Bay dock and Ratchet pier.
    name: 'Booty Bay ↔ Ratchet',
    kind: 'boat',
    a: { mapId: 1434, x: 25.8, y: 73.0 },
    b: { mapId: 1413, x: 63.7, y: 38.6 },
    crossing: 120,
    wait: 180,
    faction: 'both',
    confidence: 'guess',
  },
  {
    // Guess: Menethil Harbor's Theramore pier.
    name: 'Menethil Harbor ↔ Theramore',
    kind: 'boat',
    a: { mapId: 1437, x: 4.6, y: 57.1 },
    b: { mapId: 1445, x: 71.6, y: 56.4 },
    crossing: 120,
    wait: 180,
    faction: 'Alliance',
    confidence: 'guess',
  },
  {
    // Guess: Menethil Harbor's Darkshore pier.
    name: 'Menethil Harbor ↔ Auberdine',
    kind: 'boat',
    a: { mapId: 1437, x: 4.9, y: 63.4 },
    b: { mapId: 1439, x: 32.5, y: 43.7 },
    crossing: 120,
    wait: 180,
    faction: 'Alliance',
    confidence: 'guess',
  },
  {
    // Guess: Auberdine's Teldrassil pier and Rut'theran Village dock.
    name: "Auberdine ↔ Rut'theran Village",
    kind: 'boat',
    a: { mapId: 1439, x: 33.2, y: 40.0 },
    b: { mapId: 1438, x: 54.9, y: 96.8 },
    crossing: 60,
    wait: 120,
    faction: 'Alliance',
    confidence: 'guess',
  },
];
