#!/bin/bash
# ============================================================
# add-festival.sh — Seed a new festival into HOOKD
#
# Usage:
#   ./add-festival.sh "Festival Name" "festival-slug" artists.txt
#
# artists.txt should contain one artist per line:
#   Kendrick Lamar
#   Chappell Roan
#   Sabrina Carpenter
#   ...
#
# Set these env vars (or create a .env file next to this script):
#   SUPABASE_URL=https://your-project.supabase.co
#   SUPABASE_ANON_KEY=your-anon-key
# ============================================================

set -euo pipefail

# --- Load .env if present ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  source "$SCRIPT_DIR/.env"
fi

# --- Validate inputs ---
if [ $# -lt 3 ]; then
  echo ""
  echo "Usage: ./add-festival.sh \"Festival Name\" \"festival-slug\" artists.txt"
  echo ""
  echo "Example:"
  echo "  ./add-festival.sh \"Governors Ball 2026\" \"govball-2026\" govball-artists.txt"
  echo ""
  exit 1
fi

FEST_NAME="$1"
FEST_SLUG="$2"
ARTISTS_FILE="$3"

if [ ! -f "$ARTISTS_FILE" ]; then
  echo "Error: File '$ARTISTS_FILE' not found."
  exit 1
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set."
  echo "Either export them or add them to a .env file next to this script."
  exit 1
fi

# --- Common headers for all Supabase requests ---
AUTH_HEADERS=(
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}"
  -H "apikey: ${SUPABASE_ANON_KEY}"
  -H "Content-Type: application/json"
)

# --- Read artists from file, skip blank lines and comments ---
ARTISTS=""
while IFS= read -r line || [ -n "$line" ]; do
  trimmed="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -z "$trimmed" ] && continue
  [[ "$trimmed" == \#* ]] && continue
  
  if [ -z "$ARTISTS" ]; then
    ARTISTS="$trimmed"
  else
    ARTISTS="$ARTISTS, $trimmed"
  fi
done < "$ARTISTS_FILE"

ARTIST_COUNT=$(echo "$ARTISTS" | tr ',' '\n' | wc -l | tr -d ' ')

echo ""
echo "🎵 Adding festival: $FEST_NAME ($FEST_SLUG)"
echo "   Artists: $ARTIST_COUNT"
echo ""

# ============================================================
# STEP 1: Seed the festival
# ============================================================
echo "━━━ Step 1/3: Seeding festival + auto-tiering artists ━━━"

ESCAPED_NAME=$(echo "$FEST_NAME" | sed 's/"/\\"/g')
ESCAPED_SLUG=$(echo "$FEST_SLUG" | sed 's/"/\\"/g')
ESCAPED_ARTISTS=$(echo "$ARTISTS" | sed 's/"/\\"/g')

SEED_RESPONSE=$(curl -s -L -w "\n%{http_code}" -X POST \
  "${SUPABASE_URL}/functions/v1/seed-festival" \
  "${AUTH_HEADERS[@]}" \
  -d "{\"name\":\"${ESCAPED_NAME}\",\"slug\":\"${ESCAPED_SLUG}\",\"artists\":\"${ESCAPED_ARTISTS}\"}")

SEED_HTTP=$(echo "$SEED_RESPONSE" | tail -1)
SEED_BODY=$(echo "$SEED_RESPONSE" | sed '$d')

if [ "$SEED_HTTP" -ge 200 ] && [ "$SEED_HTTP" -lt 300 ]; then
  echo "✅ Festival seeded ($SEED_HTTP)"
  echo "   $SEED_BODY" | head -5
else
  echo "❌ Failed to seed festival (HTTP $SEED_HTTP)"
  echo "   $SEED_BODY"
  exit 1
fi

echo ""

# ============================================================
# STEP 2: Populate track catalogs (50 tracks per artist)
# ============================================================
echo "━━━ Step 2/3: Populating track catalogs from Last.fm ━━━"

POP_RESPONSE=$(curl -s -L -w "\n%{http_code}" -X POST \
  "${SUPABASE_URL}/functions/v1/populate-festival-tracks" \
  "${AUTH_HEADERS[@]}")

POP_HTTP=$(echo "$POP_RESPONSE" | tail -1)
POP_BODY=$(echo "$POP_RESPONSE" | sed '$d')

if [ "$POP_HTTP" -ge 200 ] && [ "$POP_HTTP" -lt 300 ]; then
  echo "✅ Track catalogs populated ($POP_HTTP)"
  echo "   $POP_BODY" | head -5
else
  echo "❌ Failed to populate tracks (HTTP $POP_HTTP)"
  echo "   $POP_BODY"
  exit 1
fi

echo ""

# ============================================================
# STEP 3: Resolve iTunes preview URLs (loop until done)
# ============================================================
echo "━━━ Step 3/3: Resolving iTunes preview URLs ━━━"

RESOLVE_PASS=0
while true; do
  RESOLVE_PASS=$((RESOLVE_PASS + 1))
  echo "   Pass $RESOLVE_PASS..."

  RES_RESPONSE=$(curl -s -L -w "\n%{http_code}" -X POST \
    "${SUPABASE_URL}/functions/v1/resolve-festival-itunes" \
    "${AUTH_HEADERS[@]}")

  RES_HTTP=$(echo "$RES_RESPONSE" | tail -1)
  RES_BODY=$(echo "$RES_RESPONSE" | sed '$d')

  if [ "$RES_HTTP" -ge 200 ] && [ "$RES_HTTP" -lt 300 ]; then
    echo "   ✅ Pass $RESOLVE_PASS complete ($RES_HTTP)"
    
    if echo "$RES_BODY" | grep -qi '"done"[[:space:]]*:[[:space:]]*true'; then
      echo "   🎉 All tracks resolved!"
      break
    fi
    
    echo "   $RES_BODY" | head -3
    echo "   Waiting 5s before next pass..."
    sleep 5
  else
    echo "   ❌ Resolve failed (HTTP $RES_HTTP)"
    echo "   $RES_BODY"
    echo "   Waiting 10s before retry..."
    sleep 10
    
    if [ "$RESOLVE_PASS" -ge 20 ]; then
      echo "   ⚠️  Stopping after 20 passes. Some tracks may be unresolved."
      break
    fi
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Done! '$FEST_NAME' is ready in HOOKD."
echo ""
echo "Verify in Supabase:"
echo "  SELECT name, tier, listeners FROM festival_artists"
echo "  WHERE festival_slug = '$FEST_SLUG' ORDER BY listeners DESC;"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"