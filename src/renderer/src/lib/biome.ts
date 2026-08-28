import { hexToTuple } from './canvas';

export interface BiomeDef {
  id: string;
  label: string;
  temperature: number;
  downfall: number;
  grass: string;
  foliage: string;
  dryFoliage: string;
}

// Vanilla base temperatures / downfalls (clamped 0..1 for colormap indexing).
export const DEFAULT_BIOMES: BiomeDef[] = [
  { id: 'minecraft:plains', label: 'Plains', temperature: 0.8, downfall: 0.4, grass: '#6fae3b', foliage: '#48a037', dryFoliage: '#9fa12c' },
  { id: 'minecraft:sunflower_plains', label: 'Sunflower Plains', temperature: 0.8, downfall: 0.4, grass: '#6fae3b', foliage: '#48a037', dryFoliage: '#9fa12c' },
  { id: 'minecraft:forest', label: 'Forest', temperature: 0.7, downfall: 0.8, grass: '#4eb02b', foliage: '#3ba028', dryFoliage: '#9fa12c' },
  { id: 'minecraft:flower_forest', label: 'Flower Forest', temperature: 0.7, downfall: 0.8, grass: '#4eb02b', foliage: '#3ba028', dryFoliage: '#9fa12c' },
  { id: 'minecraft:birch_forest', label: 'Birch Forest', temperature: 0.6, downfall: 0.6, grass: '#5fa92e', foliage: '#3ba028', dryFoliage: '#9fa12c' },
  { id: 'minecraft:dark_forest', label: 'Dark Forest', temperature: 0.7, downfall: 0.8, grass: '#3a8a2a', foliage: '#2c7a24', dryFoliage: '#9fa12c' },
  { id: 'minecraft:taiga', label: 'Taiga', temperature: 0.25, downfall: 0.8, grass: '#5a9c3a', foliage: '#3f8f3a', dryFoliage: '#9fa12c' },
  { id: 'minecraft:old_growth_pine_taiga', label: 'Old Growth Pine Taiga', temperature: 0.3, downfall: 0.8, grass: '#56853a', foliage: '#3f8f3a', dryFoliage: '#9fa12c' },
  { id: 'minecraft:old_growth_spruce_taiga', label: 'Old Growth Spruce Taiga', temperature: 0.25, downfall: 0.6, grass: '#56853a', foliage: '#3f8f3a', dryFoliage: '#9fa12c' },
  { id: 'minecraft:snowy_plains', label: 'Snowy Plains', temperature: 0.05, downfall: 0.3, grass: '#c8d7c8', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:snowy_tundra', label: 'Snowy Tundra', temperature: 0.0, downfall: 0.5, grass: '#c8d7c8', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:snowy_beach', label: 'Snowy Beach', temperature: 0.05, downfall: 0.3, grass: '#c8d7c8', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:beach', label: 'Beach', temperature: 0.8, downfall: 0.4, grass: '#a3b86a', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:desert', label: 'Desert', temperature: 2.0, downfall: 0.0, grass: '#bfa45c', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:savanna', label: 'Savanna', temperature: 1.2, downfall: 0.0, grass: '#9c9a3c', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:savanna_plateau', label: 'Savanna Plateau', temperature: 1.0, downfall: 0.0, grass: '#9c9a3c', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:windswept_hills', label: 'Windswept Hills', temperature: 0.2, downfall: 0.3, grass: '#5f9c3a', foliage: '#3f8f3a', dryFoliage: '#9fa12c' },
  { id: 'minecraft:stony_shore', label: 'Stony Shore', temperature: 0.2, downfall: 0.3, grass: '#6f8b4a', foliage: '#3f8f3a', dryFoliage: '#9fa12c' },
  { id: 'minecraft:river', label: 'River', temperature: 0.5, downfall: 0.5, grass: '#4f9e3a', foliage: '#3ba028', dryFoliage: '#9fa12c' },
  { id: 'minecraft:frozen_river', label: 'Frozen River', temperature: 0.0, downfall: 0.5, grass: '#c8d7c8', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:ocean', label: 'Ocean', temperature: 0.5, downfall: 0.5, grass: '#4f9e3a', foliage: '#3ba028', dryFoliage: '#9fa12c' },
  { id: 'minecraft:jungle', label: 'Jungle', temperature: 0.95, downfall: 0.9, grass: '#3aa329', foliage: '#2e8f24', dryFoliage: '#9fa12c' },
  { id: 'minecraft:bamboo_jungle', label: 'Bamboo Jungle', temperature: 0.9, downfall: 0.9, grass: '#3aa329', foliage: '#2e8f24', dryFoliage: '#9fa12c' },
  { id: 'minecraft:sparse_jungle', label: 'Sparse Jungle', temperature: 0.95, downfall: 0.8, grass: '#3aa329', foliage: '#2e8f24', dryFoliage: '#9fa12c' },
  { id: 'minecraft:swamp', label: 'Swamp', temperature: 0.8, downfall: 0.9, grass: '#4f7a2e', foliage: '#3a6a26', dryFoliage: '#9fa12c' },
  { id: 'minecraft:mangrove_swamp', label: 'Mangrove Swamp', temperature: 0.8, downfall: 0.9, grass: '#4f7a2e', foliage: '#3a6a26', dryFoliage: '#9fa12c' },
  { id: 'minecraft:badlands', label: 'Badlands', temperature: 2.0, downfall: 0.0, grass: '#b0703c', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:eroded_badlands', label: 'Eroded Badlands', temperature: 2.0, downfall: 0.0, grass: '#b0703c', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:wooded_badlands', label: 'Wooded Badlands', temperature: 2.0, downfall: 0.0, grass: '#9c8a3c', foliage: '#9fa12c', dryFoliage: '#9fa12c' },
  { id: 'minecraft:nether_wastes', label: 'Nether Wastes', temperature: 2.0, downfall: 0.0, grass: '#7a3a2a', foliage: '#5a2a1a', dryFoliage: '#5a2a1a' },
  { id: 'minecraft:cherry_grove', label: 'Cherry Grove', temperature: 0.5, downfall: 0.8, grass: '#8bbf5a', foliage: '#6a9c3a', dryFoliage: '#9fa12c' },
  { id: 'minecraft:meadow', label: 'Meadow', temperature: 0.5, downfall: 0.8, grass: '#5fae3a', foliage: '#3ba028', dryFoliage: '#9fa12c' },
  { id: 'minecraft:pale_garden', label: 'Pale Garden', temperature: 0.5, downfall: 0.8, grass: '#9fb98a', foliage: '#8aa06f', dryFoliage: '#9fa12c' },
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Map a biome's base temp/downfall to the adjusted colormap coordinates used by
// Minecraft: adjTemp = clamp(temp), adjDownfall = clamp(downfall) * adjTemp.
function adjCoords(b: BiomeDef): { at: number; ad: number } {
  const at = clamp01(b.temperature);
  const ad = clamp01(b.downfall) * at;
  return { at, ad };
}

export interface ColormapSet {
  grass: Uint8ClampedArray;
  foliage: Uint8ClampedArray;
  dryFoliage: Uint8ClampedArray;
}

/**
 * Build the three 256x256 global colormaps. For every pixel we reconstruct the
 * (adjTemp, adjDownfall) it represents and color it with the nearest biome's
 * chosen color (Voronoi by colormap coordinates), matching vanilla sampling.
 */
export function generateBiomeColormaps(biomes: BiomeDef[]): ColormapSet {
  const size = 256;
  const anchors = biomes.map((b) => {
    const { at, ad } = adjCoords(b);
    return {
      at,
      ad,
      grass: hexToTuple(b.grass),
      foliage: hexToTuple(b.foliage),
      dryFoliage: hexToTuple(b.dryFoliage),
    };
  });

  const grass = new Uint8ClampedArray(size * size * 4);
  const foliage = new Uint8ClampedArray(size * size * 4);
  const dryFoliage = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    const adjDownfall = 1 - y / (size - 1); // y = (1 - adjDownfall) * 255
    for (let x = 0; x < size; x++) {
      const adjTemp = 1 - x / (size - 1); // x = (1 - adjTemp) * 255
      // Nearest biome in colormap space.
      let best = anchors[0];
      let bestD = Infinity;
      for (const a of anchors) {
        const dt = a.at - adjTemp;
        const dd = a.ad - adjDownfall;
        const d = dt * dt + dd * dd;
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      const i = (y * size + x) * 4;
      grass[i] = best.grass[0];
      grass[i + 1] = best.grass[1];
      grass[i + 2] = best.grass[2];
      grass[i + 3] = 255;
      foliage[i] = best.foliage[0];
      foliage[i + 1] = best.foliage[1];
      foliage[i + 2] = best.foliage[2];
      foliage[i + 3] = 255;
      dryFoliage[i] = best.dryFoliage[0];
      dryFoliage[i + 1] = best.dryFoliage[1];
      dryFoliage[i + 2] = best.dryFoliage[2];
      dryFoliage[i + 3] = 255;
    }
  }

  return { grass, foliage, dryFoliage };
}
