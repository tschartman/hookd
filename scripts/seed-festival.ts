#!/usr/bin/env node
/**
 * HOOKD Festival Seed Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Inserts a festival + artist lineup into Supabase.
 *
 * Run:
 *   npx tsx scripts/seed-festival.ts
 *
 * Requires the service role key (not the anon key) so it can bypass RLS:
 *   EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY
 *
 * These can be set in .env.local or exported in your shell before running.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { createClient } from '@supabase/supabase-js';

// ─── Load .env.local ──────────────────────────────────────────────────────────

function loadEnvFile(): void {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key   = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const supabaseUrl      = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey      = process.env.SUPABASE_SERVICE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '\nMissing Supabase credentials.\n' +
    'Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local or your shell.\n' +
    '(Using the anon key will fail for inserts due to RLS. Use the service role key.)\n',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Readline helpers ─────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askWithDefault(question: string, defaultVal: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultVal}]: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

/**
 * Collect multi-line paste. User pastes a block of text and signals
 * done with an empty line.
 */
function askMultiline(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    console.log(prompt);
    console.log('(Paste your list, then press Enter twice to finish)\n');
    const lines: string[] = [];
    rl.on('line', (line) => {
      if (line.trim() === '' && lines.length > 0) {
        resolve(lines.join('\n'));
        rl.removeAllListeners('line');
      } else {
        lines.push(line);
      }
    });
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ArtistTier = 'headliner' | 'midtier' | 'opener';

interface ArtistInput {
  name: string;
  tier: ArtistTier;
  genres: string[];
}

// ─── Tier assignment ──────────────────────────────────────────────────────────

function autoAssignTiers(
  names: string[],
  headlinerCount: number,
  midtierCount: number,
): ArtistInput[] {
  return names.map((name, i) => {
    let tier: ArtistTier;
    if (i < headlinerCount) {
      tier = 'headliner';
    } else if (i < headlinerCount + midtierCount) {
      tier = 'midtier';
    } else {
      tier = 'opener';
    }
    return { name, tier, genres: [] };
  });
}

function printTierPreview(artists: ArtistInput[]): void {
  const headliners = artists.filter((a) => a.tier === 'headliner');
  const midtiers   = artists.filter((a) => a.tier === 'midtier');
  const openers    = artists.filter((a) => a.tier === 'opener');

  console.log('\n──────────────────────────────────────');
  console.log(`HEADLINERS (${headliners.length}): ${headliners.map((a) => a.name).join(', ')}`);
  console.log(`MID-TIER   (${midtiers.length}): ${midtiers.map((a) => a.name).join(', ')}`);
  console.log(`OPENERS    (${openers.length}): ${openers.map((a) => a.name).join(', ')}`);
  console.log('──────────────────────────────────────\n');
}

// ─── Parse artist list ────────────────────────────────────────────────────────

function parseArtistList(raw: string): string[] {
  // Support comma-separated, newline-separated, or mixed
  const names = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '-');

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Manual tier override ─────────────────────────────────────────────────────

async function applyManualOverrides(artists: ArtistInput[]): Promise<ArtistInput[]> {
  const doOverride = await ask('Override any artist tiers? (y/N): ');
  if (doOverride.toLowerCase() !== 'y') return artists;

  console.log('\nFor each artist you want to override, enter: "Name, tier"');
  console.log('Tiers: h = headliner, m = midtier, o = opener');
  console.log('Press Enter twice when done.\n');

  const overrides: ArtistInput[] = [...artists];

  await new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      if (line.trim() === '') {
        rl.removeAllListeners('line');
        resolve();
        return;
      }

      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 2) {
        console.log('  Skipping: invalid format (expected "Name, tier")');
        return;
      }

      const artistName  = parts[0];
      const tierInput   = parts[1].toLowerCase();
      const tierMap: Record<string, ArtistTier> = {
        h: 'headliner', headliner: 'headliner',
        m: 'midtier',   midtier: 'midtier',
        o: 'opener',    opener: 'opener',
      };
      const tier = tierMap[tierInput];
      if (!tier) {
        console.log(`  Unknown tier "${tierInput}" for ${artistName} — skipping`);
        return;
      }

      const idx = overrides.findIndex(
        (a) => a.name.toLowerCase() === artistName.toLowerCase(),
      );
      if (idx === -1) {
        console.log(`  Artist "${artistName}" not found — skipping`);
        return;
      }

      overrides[idx] = { ...overrides[idx], tier };
      console.log(`  ✓ ${overrides[idx].name} → ${tier}`);
    });
  });

  return overrides;
}

// ─── Insert to Supabase ───────────────────────────────────────────────────────

async function insertFestival(
  festivalData: {
    name: string;
    slug: string;
    dates: string;
    location: string;
    description: string;
    genre_tags: string[];
    estimated_attendance: number;
    image_color_primary: string;
    image_color_secondary: string;
    year: number;
  },
  artists: ArtistInput[],
): Promise<void> {
  console.log('\nInserting festival…');

  // Upsert festival (on conflict with slug, update it)
  const { data: festival, error: festError } = await supabase
    .from('festivals')
    .upsert(festivalData, { onConflict: 'slug' })
    .select('id, name')
    .single();

  if (festError || !festival) {
    throw new Error(`Festival insert failed: ${festError?.message ?? 'unknown error'}`);
  }

  console.log(`  ✓ Festival "${festival.name}" (id: ${festival.id})`);

  // Insert artists in batches of 50
  const rows = artists.map((a) => ({
    festival_id: festival.id,
    name:        a.name,
    tier:        a.tier,
    genres:      a.genres,
  }));

  const BATCH = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error: artistError } = await supabase
      .from('festival_artists')
      .upsert(batch, { onConflict: 'festival_id,name' });

    if (artistError) {
      throw new Error(`Artist insert failed (batch ${i / BATCH + 1}): ${artistError.message}`);
    }
    inserted += batch.length;
  }

  console.log(`  ✓ ${inserted} artists inserted`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔═══════════════════════════════════╗');
  console.log('║   HOOKD Festival Seed Script      ║');
  console.log('╚═══════════════════════════════════╝\n');

  // ── Festival details ────────────────────────────────────────────────────
  const name        = await ask('Festival name: ');
  const defaultSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slug        = await askWithDefault('Slug', defaultSlug);
  const dates       = await ask('Dates (e.g. "July 30 – Aug 2, 2026"): ');
  const location    = await ask('Location (e.g. "Grant Park, Chicago, IL"): ');
  const description = await ask('Short description: ');
  const genreStr    = await ask('Genre tags (comma-separated, e.g. "pop, rock, hip-hop"): ');
  const genre_tags  = genreStr.split(',').map((g) => g.trim()).filter(Boolean);
  const attendStr   = await askWithDefault('Estimated attendance', '100000');
  const estimated_attendance = parseInt(attendStr, 10) || 100000;
  const yearStr     = await askWithDefault('Year', String(new Date().getFullYear()));
  const year        = parseInt(yearStr, 10) || new Date().getFullYear();
  const image_color_primary   = await askWithDefault('Primary color (hex)', '#1DB954');
  const image_color_secondary = await askWithDefault('Secondary color (hex)', '#0A0A0A');

  // ── Artist list ─────────────────────────────────────────────────────────
  const rawArtists = await askMultiline('\nPaste artist list:');
  const artistNames = parseArtistList(rawArtists);

  if (artistNames.length === 0) {
    console.error('\nNo artists parsed. Exiting.');
    process.exit(1);
  }

  console.log(`\nParsed ${artistNames.length} artists.`);

  // ── Tier counts ─────────────────────────────────────────────────────────
  const defaultHeadliners = Math.min(8, Math.ceil(artistNames.length * 0.08));
  const defaultMidtiers   = Math.min(20, Math.ceil(artistNames.length * 0.25));

  const headlinerCount = parseInt(
    await askWithDefault(`How many headliners`, String(defaultHeadliners)),
    10,
  ) || defaultHeadliners;

  const midtierCount = parseInt(
    await askWithDefault(`How many mid-tier acts`, String(defaultMidtiers)),
    10,
  ) || defaultMidtiers;

  // ── Assign tiers and preview ─────────────────────────────────────────────
  let artists = autoAssignTiers(artistNames, headlinerCount, midtierCount);
  printTierPreview(artists);

  // ── Optional overrides ───────────────────────────────────────────────────
  artists = await applyManualOverrides(artists);

  // ── Confirm ──────────────────────────────────────────────────────────────
  console.log('\n── Summary ──────────────────────────────────────────────────');
  console.log(`  Name:        ${name}`);
  console.log(`  Slug:        ${slug}`);
  console.log(`  Dates:       ${dates}`);
  console.log(`  Location:    ${location}`);
  console.log(`  Genres:      ${genre_tags.join(', ')}`);
  console.log(`  Attendance:  ${estimated_attendance.toLocaleString()}`);
  console.log(`  Year:        ${year}`);
  console.log(`  Artists:     ${artists.length} total (${artists.filter((a) => a.tier === 'headliner').length} headliners, ${artists.filter((a) => a.tier === 'midtier').length} mid-tier, ${artists.filter((a) => a.tier === 'opener').length} openers)`);
  console.log('─────────────────────────────────────────────────────────────\n');

  const confirm = await ask('Insert this data? (y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    rl.close();
    return;
  }

  // ── Insert ───────────────────────────────────────────────────────────────
  await insertFestival(
    {
      name,
      slug,
      dates,
      location,
      description,
      genre_tags,
      estimated_attendance,
      image_color_primary,
      image_color_secondary,
      year,
    },
    artists,
  );

  console.log(`\n✓ Done! "${name}" is now live in Supabase.\n`);
  rl.close();
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : err);
  rl.close();
  process.exit(1);
});
