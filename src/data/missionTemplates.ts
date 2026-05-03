// ─── Mission Templates ────────────────────────────────────────────────────────
// Preset configurations for mission-based playlist building.

export type EnergyTarget = 'low' | 'medium' | 'high';

export interface MissionTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Shown below the name on the template selector card. */
  subtitle: string;
  /** Tags that are NEVER queried, regardless of vibe selection. */
  excludeTags: string[];
  /** Genres pre-highlighted on the vibe selection screen (user can deselect). */
  suggestedGenres: string[];
  /** Seed artists used when user taps "Skip — surprise me". */
  fallbackSeedArtists: string[];
  /** MB tags used when user taps "Skip — surprise me". */
  fallbackMusicbrainzTags: string[];
  energyTarget: EnergyTarget;
  suggestedCount: number;
  /** Default genres pre-applied on mission mount (shown in filter sheet, user can modify). */
  defaultGenres: string[];
  /** Default eras pre-applied on mission mount; empty = any era. */
  defaultEras: string[];
}

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: 'running',
    name: 'Running',
    icon: '🏃',
    description: 'High energy tracks to keep your pace',
    subtitle: 'Next: pick your sound',
    excludeTags: ['ballad', 'slow', 'ambient', 'lullaby', 'spoken word'],
    suggestedGenres: ['Pop', 'Electronic'],
    fallbackSeedArtists: ['Dua Lipa', 'Calvin Harris', 'The Chainsmokers'],
    fallbackMusicbrainzTags: ['pop', 'dance', 'electronic', 'edm', 'dance-pop'],
    energyTarget: 'high',
    suggestedCount: 25,
    defaultGenres: ['pop', 'electronic', 'dance', 'hip-hop'],
    defaultEras: ['00s', '10s', '20s'],
  },
  {
    id: 'gym',
    name: 'Gym',
    icon: '💪',
    description: 'Aggressive beats for heavy sets',
    subtitle: 'Next: pick your sound',
    excludeTags: ['ballad', 'acoustic', 'lullaby', 'classical', 'ambient'],
    suggestedGenres: ['Hip-Hop', 'Electronic'],
    fallbackSeedArtists: ['Eminem', 'Travis Scott', 'Skrillex'],
    fallbackMusicbrainzTags: ['hip hop', 'rap', 'trap', 'electronic', 'dubstep'],
    energyTarget: 'high',
    suggestedCount: 30,
    defaultGenres: ['hip-hop', 'electronic', 'rock', 'metal'],
    defaultEras: ['00s', '10s', '20s'],
  },
  {
    id: 'study',
    name: 'Study',
    icon: '📚',
    description: 'Calm instrumentals, no distractions',
    subtitle: 'Next: pick your sound',
    excludeTags: ['metal', 'punk', 'edm', 'hard rock', 'screamo', 'trap'],
    suggestedGenres: ['Jazz', 'Folk'],
    fallbackSeedArtists: ['Nujabes', 'Bonobo', 'Nils Frahm'],
    fallbackMusicbrainzTags: ['ambient', 'lo-fi', 'chillout', 'downtempo', 'jazz'],
    energyTarget: 'low',
    suggestedCount: 40,
    defaultGenres: ['ambient', 'jazz', 'lo-fi'],
    defaultEras: [],
  },
  {
    id: 'road-trip',
    name: 'Road Trip',
    icon: '🚗',
    description: 'Singalongs and feel-good cruising',
    subtitle: 'Next: pick your sound',
    excludeTags: ['ambient', 'drone', 'noise', 'spoken word'],
    suggestedGenres: ['Rock', 'Pop', 'Folk'],
    fallbackSeedArtists: ['Fleetwood Mac', 'Tom Petty', 'The Lumineers'],
    fallbackMusicbrainzTags: ['rock', 'pop', 'classic rock', 'indie', 'folk rock'],
    energyTarget: 'medium',
    suggestedCount: 35,
    defaultGenres: ['rock', 'pop', 'indie'],
    defaultEras: [],
  },
  {
    id: 'party',
    name: 'Party',
    icon: '🎉',
    description: 'Bangers to get the energy up',
    subtitle: 'Next: pick your sound',
    excludeTags: ['ambient', 'classical', 'folk', 'acoustic', 'spoken word'],
    suggestedGenres: ['Pop', 'Hip-Hop', 'Electronic'],
    fallbackSeedArtists: ['Beyoncé', 'Drake', 'Doja Cat'],
    fallbackMusicbrainzTags: ['dance', 'pop', 'hip hop', 'house', 'funk', 'disco'],
    energyTarget: 'high',
    suggestedCount: 25,
    defaultGenres: ['pop', 'hip-hop', 'dance', 'electronic'],
    defaultEras: ['00s', '10s', '20s'],
  },
  {
    id: 'chill',
    name: 'Chill',
    icon: '😌',
    description: 'Mellow vibes for winding down',
    subtitle: 'Next: pick your sound',
    excludeTags: ['metal', 'punk', 'hardcore', 'screamo', 'industrial'],
    suggestedGenres: ['R&B', 'Jazz'],
    fallbackSeedArtists: ['Frank Ocean', 'Daniel Caesar', 'Khruangbin'],
    fallbackMusicbrainzTags: ['r&b', 'neo soul', 'chillout', 'lo-fi', 'soul'],
    energyTarget: 'low',
    suggestedCount: 20,
    defaultGenres: ['r&b', 'soul', 'ambient', 'lo-fi'],
    defaultEras: [],
  },
  {
    id: 'morning',
    name: 'Morning Coffee',
    icon: '☕',
    description: 'Easy, warm start to your day',
    subtitle: 'Next: pick your sound',
    excludeTags: ['metal', 'punk', 'hardcore', 'trap', 'edm'],
    suggestedGenres: ['Folk', 'Jazz'],
    fallbackSeedArtists: ['Norah Jones', 'Jack Johnson', 'Kacey Musgraves'],
    fallbackMusicbrainzTags: ['singer-songwriter', 'folk', 'indie folk', 'acoustic', 'jazz'],
    energyTarget: 'low',
    suggestedCount: 20,
    defaultGenres: ['folk', 'jazz'],
    defaultEras: [],
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '✨',
    description: 'Build from scratch',
    subtitle: 'Build from scratch',
    excludeTags: [],
    suggestedGenres: [],
    fallbackSeedArtists: [],
    fallbackMusicbrainzTags: ['pop', 'rock', 'hip hop', 'electronic', 'indie'],
    energyTarget: 'medium',
    suggestedCount: 25,
    defaultGenres: [],
    defaultEras: [],
  },
];
