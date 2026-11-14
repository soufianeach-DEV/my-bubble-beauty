export type Season = 'auto' | 'on' | 'off';
export function seasonOn(mode: Season, now?: Date): boolean;
export function seasonMode(value: unknown): Season;
export function winterHome(path: string, on: boolean): string | null;
export function winterDirect(path: string): string | null;
