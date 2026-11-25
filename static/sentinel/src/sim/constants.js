// Fixed facts of the simulation that are not balance numbers (those live in data/tuning.json).

/** simulation ticks per second */
export const TICK_HZ = 60;
/** seconds per tick */
export const DT = 1 / TICK_HZ;
/** ground tile size in world pixels (the oblique 0.75 ratio of spec §2) */
export const TILE_W = 32;
export const TILE_H = 24;
