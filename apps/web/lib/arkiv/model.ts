import {isAddress} from 'viem';

export type Season = {id: string; startBlock: bigint; endBlock: bigint};
export function seasonAt(block: bigint, anchor: bigint, length: bigint): Season | null {
  if (anchor < 0n || length < 2n) throw new Error('Invalid season schedule');
  if (block < anchor) return null;
  const index = (block - anchor) / length;
  return {id: String(index + 1n), startBlock: anchor + index * length, endBlock: anchor + (index + 1n) * length};
}
export function pointsFor(won: boolean, matches: number) {return won ? matches === 5 ? 100 : matches === 3 ? 30 : 0 : 0;}
export type Contribution = {gameId: string; player: string; points: number; won: boolean; expiresAt: bigint};
export type Ranking = {player: string; points: number; spins: number; wins: number};
export function rank(entries: Contribution[], block: bigint): Ranking[] {
  const seen = new Set<string>(), players = new Map<string, Ranking>();
  for (const entry of entries) {
    if (entry.expiresAt <= block || seen.has(entry.gameId)) continue;
    if (!/^\d+$/.test(entry.gameId) || !isAddress(entry.player) || ![0,30,100].includes(entry.points) || typeof entry.won !== 'boolean') throw new Error('Invalid contribution');
    seen.add(entry.gameId);
    const player = entry.player.toLowerCase();
    const row = players.get(player) || {player, points: 0, spins: 0, wins: 0};
    row.points += entry.points; row.spins++; row.wins += entry.won ? 1 : 0;
    players.set(player, row);
  }
  return [...players.values()].sort((a,b) => b.points - a.points || b.wins - a.wins || a.player.localeCompare(b.player));
}
export type LeaderboardView = {
  status: 'disabled' | 'connecting' | 'live' | 'unavailable';
  season: {id: string; startBlock: string; endBlock: string} | null;
  block: string; remainingSeconds: number; updatedAt: number;
  rows: Ranking[]; players: number; indexing: boolean; message: string;
};
export const emptyView = (): LeaderboardView => ({status:'disabled', season:null, block:'0',remainingSeconds:0,updatedAt:0,rows:[],players:0,indexing:false,message:'Season leaderboard is not configured yet.'});
