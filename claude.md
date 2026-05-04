# HOOKD - Music Discovery App

## Project Overview
HOOKD is a discovery layer that sits on top of streaming services. Three ways to discover music:

1. **Feed** — A Genre × Era explorer. Spin the dial, travel through decades and genres, discover music from any era. Like having a time machine with a radio.
2. **Festivals** — Explore festival lineups, discover artists before you go.
3. **Missions** — Declare a purpose (running, studying, party), Tinder-swipe to build the perfect playlist in minutes.

**The pitch: "Your streaming service knows what you've always listened to. HOOKD lets you explore everything you've been missing."**

Saves are organized by context. Everything exports to your streaming service.

## Tech Stack
- **Framework**: React Native with Expo (SDK 54, Expo Router for file-based routing)
- **Language**: TypeScript (strict mode)
- **Discovery API**: iTunes Search API (free, no auth, reliable 30-second preview URLs)
- **Auth & Library**: Spotify Web API (OAuth 2.0 PKCE — login + playlist export)
- **Audio**: `expo-av` for preview playback
- **State**: Zustand for global state (player, collections, missions)
- **Animations**: `react-native-reanimated` + `react-native-gesture-handler`
- **Backend**: Supabase (collections, mission history, analytics)
- **Navigation**: Expo Router (file-based)

---

## MVP FEATURE SET (LOCKED)

### 1. Genre × Era Explorer (Main Feed)
The main feed is a music time machine. You land on a random genre + era combo and explore.
- Random starting point on each app open (e.g. "70s · Rock")
- Compact dial pill at top shows current selection
- Tap pill to expand smart selector: era slider + genre grid
- Feed loads songs matching the selected genre × era
- Switch genre or era → feed reloads instantly with new combo
- "Surprise Me" button for random combo
- Likes add to "Main Feed Discoveries" collection
- Likes do NOT influence what songs appear — feed is controlled only by the dial
- Pure exploration, no algorithm, no personalization on this feed

### 2. Festival Discovery
- Browse festivals, smart weighted feed with tiers
- Popular↔Discovery slider, genre filters
- Saves go to festival-specific collection
- Likes do NOT change what's shown (no "more like this")

### 3. Missions (Build Tab)
- Declare purpose → Tinder-style horizontal swipe → export playlist
- Preset templates + custom
- Adaptive learning within mission (this is where personalization lives)
- Export lineup to Spotify

### 4. Discovery Library (Profile Tab)
- Collections organized by context (main feed, festivals, missions)
- Past missions with re-export
- Export any collection to Spotify
- Connected services, stats

---

## APP ARCHITECTURE — FOUR TABS

### Tab 1: Feed (Genre × Era Explorer)
A time machine with a radio dial. No personalization, no algorithm. Pure exploration controlled by the user.

**The Dial** (genre × era selector):
- Compact state: small pill at top of feed showing "70s · Rock"
- Expanded state: tap pill to open selector overlay
  - Era slider: horizontal scroll of decade buttons
    60s | 70s | 80s | 90s | 00s | 10s | 20s
  - Genre grid: tappable genre chips (2-3 rows)
    Rock | Pop | Hip-Hop | R&B | Electronic | Country | Jazz | Folk | Latin | Classical | Punk | Metal | Reggae | Blues | Soul
  - "Surprise Me" button — picks random era + genre combo
  - Tapping any era or genre immediately reloads the feed
  - Tap outside the expanded selector or tap the pill again to collapse
- The dial should be easy to access but NOT in the way during swiping
- When collapsed, it's a small unobtrusive pill at the very top

**The Feed**:
- Same vertical swipe UX as before (TikTok-style)
- Songs match the selected genre × era combo
- Auto-scroll when preview ends
- NO skip button, swipe only
- Heart/save adds to "Main Feed Discoveries" collection
- Hearts do NOT change feed content — only the dial controls what plays

**Song Loading for Genre × Era**:
```typescript
interface EraGenreConfig {
  era: string;           // "70s", "80s", etc.
  genre: string;         // "Rock", "Pop", etc.
  searchTerms: string[]; // multiple search queries for variety
  yearRange: {           // for filtering iTunes results
    start: number;
    end: number;
  };
}
```

### Tab 2: Explore (Festivals)
Festival lineup discovery. Unchanged from current implementation.

### Tab 3: Build (Missions)
Purpose-driven playlist building. Unchanged from current implementation.

### Tab 4: Profile (Library)
Discovery library + account. Shows collections from all contexts.

---

## GENRE × ERA EXPLORER — FULL SPEC

### Era Definitions
```typescript
const ERAS = [
  { id: '60s', label: '60s', yearStart: 1960, yearEnd: 1969 },
  { id: '70s', label: '70s', yearStart: 1970, yearEnd: 1979 },
  { id: '80s', label: '80s', yearStart: 1980, yearEnd: 1989 },
  { id: '90s', label: '90s', yearStart: 1990, yearEnd: 1999 },
  { id: '00s', label: '00s', yearStart: 2000, yearEnd: 2009 },
  { id: '10s', label: '10s', yearStart: 2010, yearEnd: 2019 },
  { id: '20s', label: '20s', yearStart: 2020, yearEnd: 2029 },
];
```

### Genre Definitions with Era-Specific Search Seeds
Each genre has different search terms depending on the era, because
"rock" in the 70s means Led Zeppelin but "rock" in the 00s means
The Strokes. Using era-specific seed artists guarantees authentic results.

```typescript
interface GenreConfig {
  id: string;
  label: string;
  icon: string;
  eraSeeds: Record<string, {
    artists: string[];      // era-specific seed artists
    terms: string[];        // era-specific search terms
  }>;
}
```

#### ROCK
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 60s | The Beatles, The Rolling Stones, Jimi Hendrix, The Who, The Doors, Cream, The Kinks | "60s rock", "classic rock 1960s", "psychedelic rock" |
| 70s | Led Zeppelin, Pink Floyd, Black Sabbath, Queen, David Bowie, Aerosmith, The Eagles, Fleetwood Mac | "70s rock", "classic rock 1970s", "hard rock 70s" |
| 80s | Guns N' Roses, AC/DC, Bon Jovi, Van Halen, Def Leppard, U2, The Police | "80s rock", "arena rock", "80s hard rock" |
| 90s | Nirvana, Pearl Jam, Radiohead, Red Hot Chili Peppers, Oasis, Foo Fighters, Soundgarden | "90s rock", "grunge", "alternative rock 90s" |
| 00s | The Strokes, Arctic Monkeys, The White Stripes, Muse, Green Day, Linkin Park, The Killers | "2000s rock", "garage rock revival", "indie rock 2000s" |
| 10s | Tame Impala, Arctic Monkeys, The Black Keys, Cage The Elephant, Royal Blood, Greta Van Fleet | "2010s rock", "modern rock", "indie rock 2010s" |
| 20s | Måneskin, Wet Leg, Turnstile, Fontaines D.C., The Last Dinner Party | "2020s rock", "new rock", "modern rock 2020s" |

#### POP
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 60s | The Supremes, The Beach Boys, Dusty Springfield, Petula Clark | "60s pop", "motown", "60s pop hits" |
| 70s | ABBA, Bee Gees, Elton John, Stevie Wonder, Donna Summer, Carole King | "70s pop", "disco", "70s pop hits" |
| 80s | Michael Jackson, Madonna, Prince, Whitney Houston, George Michael, Cyndi Lauper | "80s pop", "synth pop", "80s pop hits" |
| 90s | Britney Spears, Backstreet Boys, TLC, Destiny's Child, Spice Girls, Mariah Carey | "90s pop", "teen pop", "90s pop hits" |
| 00s | Beyoncé, Rihanna, Justin Timberlake, Nelly Furtado, Gwen Stefani, Usher | "2000s pop", "pop r&b 2000s", "pop hits 2000s" |
| 10s | Taylor Swift, Ariana Grande, Ed Sheeran, Bruno Mars, Adele, The Weeknd, Billie Eilish | "2010s pop", "modern pop hits", "pop 2010s" |
| 20s | Olivia Rodrigo, Dua Lipa, Harry Styles, Sabrina Carpenter, Chappell Roan, Doja Cat | "2020s pop", "new pop", "pop hits 2020s" |

#### HIP-HOP
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 80s | Run-DMC, Grandmaster Flash, Beastie Boys, LL Cool J, Public Enemy, N.W.A | "80s hip hop", "old school rap", "80s rap" |
| 90s | Tupac, Notorious B.I.G., Nas, Wu-Tang Clan, OutKast, A Tribe Called Quest, Snoop Dogg | "90s hip hop", "golden age hip hop", "east coast rap 90s" |
| 00s | Eminem, Jay-Z, Kanye West, Lil Wayne, 50 Cent, Missy Elliott, T.I. | "2000s hip hop", "2000s rap hits", "crunk" |
| 10s | Kendrick Lamar, Drake, J. Cole, Travis Scott, Chance The Rapper, Tyler The Creator, Cardi B | "2010s hip hop", "modern rap", "trap music" |
| 20s | Baby Keem, JID, Lil Baby, Megan Thee Stallion, Jack Harlow, Ice Spice, GloRilla | "2020s hip hop", "new rap", "hip hop 2020s" |

#### R&B / SOUL
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 60s | Aretha Franklin, Otis Redding, Sam Cooke, Marvin Gaye, The Temptations | "60s soul", "motown soul", "classic r&b" |
| 70s | Stevie Wonder, Al Green, Curtis Mayfield, Earth Wind & Fire, Bill Withers | "70s soul", "funk 70s", "70s r&b" |
| 80s | Prince, Luther Vandross, Whitney Houston, Anita Baker, New Edition | "80s r&b", "80s soul", "quiet storm" |
| 90s | D'Angelo, Erykah Badu, Lauryn Hill, TLC, Aaliyah, R. Kelly, Boyz II Men | "90s r&b", "neo soul", "new jack swing" |
| 00s | Alicia Keys, Usher, John Legend, Amy Winehouse, Ne-Yo | "2000s r&b", "neo soul 2000s", "r&b 2000s" |
| 10s | Frank Ocean, SZA, The Weeknd, H.E.R., Khalid, Daniel Caesar | "2010s r&b", "alternative r&b", "modern r&b" |
| 20s | Steve Lacy, Victoria Monét, Brent Faiyaz, Summer Walker, Tyla | "2020s r&b", "new r&b", "r&b 2020s" |

#### ELECTRONIC
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 80s | Depeche Mode, New Order, Kraftwerk, Pet Shop Boys, Erasure | "80s electronic", "synthpop 80s", "new wave" |
| 90s | The Prodigy, The Chemical Brothers, Fatboy Slim, Massive Attack, Aphex Twin, Daft Punk | "90s electronic", "big beat", "90s dance" |
| 00s | Justice, LCD Soundsystem, MGMT, Hot Chip, Röyksopp, Basement Jaxx | "2000s electronic", "electroclash", "indie electronic" |
| 10s | Skrillex, Disclosure, Flume, Odesza, Porter Robinson, Deadmau5, Avicii | "2010s electronic", "EDM", "future bass" |
| 20s | Fred Again, Peggy Gou, Bicep, Rufus Du Sol, Four Tet | "2020s electronic", "new electronic", "house 2020s" |

#### COUNTRY
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 60s | Johnny Cash, Patsy Cline, Merle Haggard, Loretta Lynn, Buck Owens | "60s country", "classic country", "outlaw country" |
| 70s | Dolly Parton, Willie Nelson, Waylon Jennings, Emmylou Harris, George Jones | "70s country", "outlaw country 70s", "country 1970s" |
| 80s | George Strait, Reba McEntire, Randy Travis, Alabama, Hank Williams Jr | "80s country", "country 1980s", "neo traditional country" |
| 90s | Garth Brooks, Shania Twain, Tim McGraw, Alan Jackson, Faith Hill | "90s country", "country pop 90s", "country 1990s" |
| 00s | Taylor Swift, Carrie Underwood, Keith Urban, Brad Paisley, Zac Brown Band | "2000s country", "country pop", "country 2000s" |
| 10s | Chris Stapleton, Kacey Musgraves, Sturgill Simpson, Luke Combs, Maren Morris | "2010s country", "modern country", "americana" |
| 20s | Zach Bryan, Morgan Wallen, Beyoncé country, Post Malone country, Shaboozey | "2020s country", "new country", "country 2020s" |

#### JAZZ
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 60s | Miles Davis, John Coltrane, Dave Brubeck, Thelonious Monk, Bill Evans | "60s jazz", "hard bop", "cool jazz" |
| 70s | Herbie Hancock, Weather Report, Pat Metheny, Return to Forever, Chick Corea | "70s jazz", "jazz fusion", "jazz funk" |
| 80s | Wynton Marsalis, Pat Metheny Group, Keith Jarrett, Michael Brecker | "80s jazz", "contemporary jazz 80s", "smooth jazz" |
| 90s | Brad Mehldau, Medeski Martin & Wood, Cassandra Wilson, Diana Krall | "90s jazz", "acid jazz", "jazz 1990s" |
| 00s | Norah Jones, Robert Glasper, Esperanza Spalding, Jamie Cullum | "2000s jazz", "nu jazz", "modern jazz" |
| 10s | Kamasi Washington, Snarky Puppy, GoGo Penguin, Jacob Collier, Thundercat | "2010s jazz", "modern jazz", "jazz fusion 2010s" |
| 20s | Ezra Collective, Shabaka, Nubya Garcia, Makaya McCraven | "2020s jazz", "new jazz", "london jazz scene" |

#### FOLK
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 60s | Bob Dylan, Joan Baez, Simon & Garfunkel, Joni Mitchell, Pete Seeger | "60s folk", "folk revival", "protest folk" |
| 70s | Joni Mitchell, Cat Stevens, Nick Drake, John Prine, James Taylor | "70s folk", "singer songwriter 70s", "folk rock 70s" |
| 80s | Suzanne Vega, Tracy Chapman, 10000 Maniacs, The Pogues | "80s folk", "folk rock 80s", "celtic folk" |
| 90s | Jeff Buckley, Elliott Smith, Ani DiFranco, The Cranberries | "90s folk", "indie folk 90s", "alternative folk" |
| 00s | Iron & Wine, Fleet Foxes, Sufjan Stevens, Devendra Banhart, Bon Iver | "2000s folk", "freak folk", "indie folk" |
| 10s | Mumford & Sons, The Lumineers, Hozier, Vance Joy, The Head and the Heart | "2010s folk", "indie folk", "folk pop" |
| 20s | Phoebe Bridgers, Big Thief, Adrianne Lenker, Noah Kahan, Caamp | "2020s folk", "new folk", "indie folk 2020s" |

#### LATIN
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 90s | Selena, Carlos Vives, Marc Anthony, Ricky Martin, Gloria Estefan | "90s latin", "latin pop 90s", "salsa 90s" |
| 00s | Shakira, Daddy Yankee, Juanes, Aventura, Don Omar | "2000s latin", "reggaeton", "latin pop 2000s" |
| 10s | J Balvin, Ozuna, Maluma, Luis Fonsi, Rosalía, Bad Bunny | "2010s latin", "reggaeton 2010s", "latin trap" |
| 20s | Bad Bunny, Karol G, Peso Pluma, Feid, Rauw Alejandro | "2020s latin", "new reggaeton", "corridos tumbados" |

#### PUNK
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 70s | Ramones, Sex Pistols, The Clash, Buzzcocks, Dead Kennedys | "70s punk", "punk rock", "original punk" |
| 80s | Black Flag, Minor Threat, Bad Brains, Misfits, Dead Kennedys, Descendents | "80s punk", "hardcore punk", "punk 80s" |
| 90s | Green Day, The Offspring, Rancid, Bad Religion, NOFX, Blink-182 | "90s punk", "pop punk", "skate punk" |
| 00s | My Chemical Romance, Fall Out Boy, Paramore, Sum 41, AFI | "2000s punk", "pop punk 2000s", "emo" |
| 10s | PUP, IDLES, Shame, Jeff Rosenstock, The Menzingers | "2010s punk", "post punk revival", "modern punk" |
| 20s | Turnstile, Amyl and the Sniffers, Militarie Gun, Scowl | "2020s punk", "new punk", "hardcore 2020s" |

#### METAL
| Era | Seed Artists | Search Terms |
|-----|-------------|-------------|
| 70s | Black Sabbath, Judas Priest, Motörhead, Deep Purple | "70s metal", "heavy metal 70s", "proto metal" |
| 80s | Metallica, Iron Maiden, Slayer, Megadeth, Ozzy Osbourne | "80s metal", "thrash metal", "heavy metal 80s" |
| 90s | Pantera, Tool, Alice in Chains, Sepultura, Type O Negative | "90s metal", "groove metal", "nu metal" |
| 00s | Mastodon, Lamb of God, Killswitch Engage, System of a Down, Slipknot | "2000s metal", "metalcore", "nu metal 2000s" |
| 10s | Ghost, Gojira, Power Trip, Deafheaven, Code Orange | "2010s metal", "modern metal", "progressive metal" |
| 20s | Knocked Loose, Sleep Token, Spiritbox, Lorna Shore | "2020s metal", "new metal", "metalcore 2020s" |

### NOT ALL COMBOS EXIST
Some genre × era combos don't make sense (Hip-Hop in the 60s, Electronic in the 60s). When a combo has no data:
- Don't show it as selectable in the UI
- Grey out or hide eras that have no seeds for the selected genre
- The genre config should mark which eras are available

### Search Strategy for Genre × Era
1. Pick 5 random seed artists from the era-specific list
2. For each, search iTunes: `GET /search?term={artist}&media=music&entity=song&attribute=artistTerm&limit=5`
3. Verify artistName matches AND check releaseDate falls within era's year range
   (iTunes returns releaseDate as ISO string, extract the year)
4. Also search with the era-specific search terms for variety: limit=15 each
5. Filter by releaseDate year range where possible
6. Combine, deduplicate, shuffle with artist spacing
7. Serve 20 tracks initially, fetch more on infinite scroll

### Year Filtering
iTunes results include `releaseDate` (ISO 8601). After fetching:
```typescript
const year = new Date(track.releaseDate).getFullYear();
const inEra = year >= eraConfig.yearStart && year <= eraConfig.yearEnd;
```
Filter strictly by year range. If not enough results pass the filter, 
relax to ±3 years (e.g., a 1979 track can appear in 80s if 80s results are thin).

### Dial UI Behavior
- **Collapsed**: Small pill at top — "[era emoji] 70s · Rock" 
  with a subtle chevron indicating it can expand
- **Expanded**: Overlay that slides down from the pill
  - Era row: horizontally scrollable decade buttons, current highlighted
  - Genre grid: 2-3 rows of genre chips, current highlighted
  - Eras that don't exist for current genre are dimmed/hidden
  - "Surprise Me 🎲" button at bottom
  - Tapping outside collapses the selector
- **Transition**: When user selects new era or genre:
  - Pill updates immediately with new label
  - Selector auto-collapses
  - Feed shows brief loading shimmer then loads new tracks
  - Current audio stops, new track starts playing

### On App Open
- Pick a random valid genre × era combo
- Show it to the user with a brief splash: "Starting you in 70s · Rock"
- This changes every time the app opens — always a fresh starting point

---

## FESTIVAL DISCOVERY — SPEC (unchanged)
Tiered artists, weighted shuffle, Popular↔Discovery slider, genre filters.
Likes go to festival collection but do NOT influence feed content.
No "more like this" injection.

---

## MISSIONS SYSTEM — SPEC (unchanged)
Tinder-style horizontal swipe, adaptive learning within missions,
preset templates with seed artists + search terms, lineup review + export.

---

## COLLECTIONS SYSTEM — SPEC (unchanged)

### Collection Types
- **Main Feed**: "Main Feed Discoveries" — saves from genre × era exploration
- **Festival**: per-festival collections
- **Mission**: per-mission lineups

### Behavior
- Likes NEVER influence feed content on main feed or festival feeds
- Likes on main feed → "Main Feed Discoveries" collection
- Likes on festival feed → festival-specific collection
- Mission right-swipes → mission-specific collection
- All collections exportable to Spotify

---

## EXPORT SYSTEM — SPEC (unchanged)

### Export Types
1. **Collection Export**: Saved songs from any collection → Spotify playlist
2. **Mission Export**: Mission lineup → Spotify playlist (preserves order)

### Playlist Naming
- Main Feed: "HOOKD Discoveries — [date]"
- Festival: "HOOKD — [Festival Name]"
- Mission: "HOOKD [Mission Name] — [date]"

---

## CRITICAL: API Architecture

### iTunes Search API — Discovery & Previews
```
GET https://itunes.apple.com/search?term={query}&media=music&entity=song&attribute=artistTerm&limit={n}
```
Free. No auth. Results include releaseDate for year filtering.

### Spotify Web API — Auth & Playlist Export
```
accounts.spotify.com/authorize
POST /api/token
GET /me
GET /v1/search?q={name}+{artist}&type=track&limit=1
POST /v1/users/{id}/playlists
POST /v1/playlists/{id}/tracks
```

---

## Project Structure
```
hookd/
├── app/
│   ├── (tabs)/
│   │   ├── _layout.tsx           # 4-tab navigator
│   │   ├── feed.tsx              # Genre × Era explorer
│   │   ├── explore.tsx           # Festival browser
│   │   ├── build.tsx             # Mission template selector
│   │   └── profile.tsx           # Discovery library
│   ├── festival/[slug].tsx       # Festival feed
│   ├── mission/[id].tsx          # Mission swipe screen
│   ├── mission/review/[id].tsx   # Lineup review + export
│   ├── collection/[slug].tsx     # Collection detail
│   └── _layout.tsx
├── src/
│   ├── components/
│   │   ├── HookCard.tsx          # Vertical feed song card
│   │   ├── GenreEraDial.tsx      # Collapsible genre × era selector
│   │   ├── EraSelector.tsx       # Decade button row
│   │   ├── GenreGrid.tsx         # Genre chip grid
│   │   ├── MissionCard.tsx       # Horizontal swipe card
│   │   ├── MissionTemplateCard.tsx
│   │   ├── MissionTopBar.tsx
│   │   ├── LineupList.tsx
│   │   ├── CardStack.tsx
│   │   ├── WaveformViz.tsx
│   │   ├── ActionBar.tsx         # Save/share (NO skip button)
│   │   ├── ExportFlow.tsx
│   │   ├── CollectionCard.tsx
│   │   ├── PastMissionCard.tsx
│   │   ├── FestivalCard.tsx
│   │   ├── PopularitySlider.tsx
│   │   ├── GenreFilters.tsx
│   │   └── SwipeFeed.tsx
│   ├── hooks/
│   │   ├── useAudioPlayer.ts
│   │   ├── useGenreEra.ts        # Genre × era feed loading + filtering
│   │   ├── useCollections.ts
│   │   ├── useMission.ts
│   │   ├── useFestivalData.ts
│   │   └── useExport.ts
│   ├── stores/
│   │   ├── playerStore.ts
│   │   ├── feedStore.ts          # Current era, genre, track queue
│   │   ├── collectionStore.ts
│   │   ├── missionStore.ts
│   │   └── userStore.ts
│   ├── services/
│   │   ├── spotify.ts
│   │   ├── itunes.ts
│   │   └── supabase.ts
│   ├── data/
│   │   ├── festivals.ts
│   │   ├── genreEraSeeds.ts      # Full genre × era seed artist/term config
│   │   └── missionTemplates.ts
│   ├── utils/
│   │   ├── feedAlgorithm.ts
│   │   ├── colors.ts
│   │   └── formatters.ts
│   └── types/
│       └── index.ts
├── assets/
├── supabase/migrations/
├── app.json
├── tsconfig.json
└── CLAUDE.md
```

---

## Coding Standards
- Functional components with hooks only
- One component per file
- Reanimated for all animations
- API calls only through service files
- Dark mode only
- Haptic feedback on save

## Common Mistakes to Avoid
- Do NOT personalize the main feed based on likes. Dial controls content only.
- Do NOT personalize the festival feed based on likes. Feed is lineup-based only.
- Do NOT add skip/next button on any vertical feed. Swipe only.
- Do NOT show loading progress for artists on any feed. Load silently in background.
- Do NOT play same artist back-to-back on any feed. Enforce artist spacing always.
- Do NOT return tracks outside the selected era's year range.
- Do NOT show era options that have no seed data for the current genre.
- Do NOT use vertical scroll for missions. Horizontal Tinder cards only.
- Do NOT let mission swipes affect other feeds.
- Do NOT use Audio.Sound without unloading.
- Do NOT use ScrollView for feeds. FlatList with pagingEnabled.
- Do NOT store Spotify tokens in AsyncStorage. Use expo-secure-store.
- Do NOT use Spotify preview_url. Use iTunes previewUrl.
- Do NOT hammer iTunes API. 60ms delays.
- Do NOT create empty collections.

## Design System
- **Background**: #0A0A0A or dynamic gradient from album art
- **Typography**: DM Sans body, Space Mono labels
- **Genre Dial Pill**: Translucent dark bg, white text, top of feed, compact
- **Genre Dial Expanded**: Dark overlay, era buttons + genre chips, easy to dismiss
- **Era Buttons**: Rounded, highlighted = accent gradient, dimmed = unavailable
- **Genre Chips**: Rounded pills, highlighted = filled accent, default = outlined
- **Tab Icons**: Music note (Feed), Compass (Explore), Plus-circle (Build), User (Profile)
- **Radius**: 16px cards, 20px pills, 50% buttons
- **Spacing**: 8px grid
- **Icons**: Lucide React Native

---

## BUILD ORDER (Current → App Store)

### ✅ DONE
1. Spotify OAuth login
2. Supabase setup
3. Festival discovery with tiers, slider, filters
4. Festival feed fixes (ordering, UI, no personalization from likes)
5. Session Vibe Engine (being replaced on main feed)
6. Collections system (saves by context)
7. Profile tab / Discovery Library
8. Export system (collections to Spotify)
9. Missions (Build tab, swipe, lineup review, export)

### ✅ DONE (continued)
10. Main feed → Genre × Era Explorer (replace vibe engine)
    - Genre × era seed data (genreEraSeeds.ts)
    - useGenreEra hook (search, year filter, queue management, MusicBrainz hybrid)
    - musicbrainz.ts service (dynamic artist discovery, 1 req/sec rate limit)
    - MusicBrainz missions integration (useMission.ts rewrite, tag weights, aggressive negative signals)
    - globalSessionStore.ts (cross-feed artist dedup)
    - GenreEraDial component (collapsed pill + expanded overlay, era row, genre grid, Surprise Me)
    - feed.tsx wired (random start on open, dial controls queue, vibe engine removed)

### ✅ DONE (continued)
11. Feed song ordering improvements (artist spacing ✅, cross-feed dedup ✅, festival feed dedup)
12. Festival lineups seeded in Supabase (3-5 festivals live)
13. Visual polish
14. App icon + splash screen
15. App Store metadata + privacy policy

### 📋 REMAINING
16. Error handling + performance (network failures, empty feed states, no crashes on first run)
17. EAS build + TestFlight + submit