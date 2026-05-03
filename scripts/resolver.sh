while true; do
  result=$(curl -L -X POST 'https://fwxabcprpuxbktdqwmkx.supabase.co/functions/v1/resolve-festival-itunes' \
  -H 'Authorization: Bearer sb_publishable_jdNYkWbsylRa640kMS1Bmw_4XZHkfgw' \
  -H 'apikey: sb_publishable_jdNYkWbsylRa640kMS1Bmw_4XZHkfgw' \
  -H 'Content-Type: application/json' \
  --data '{"name":"Functions"}')
  echo "$result" | jq .
  done=$(echo "$result" | jq -r '.done')
  remaining=$(echo "$result" | jq -r '.remainingUnresolved')
  echo "--- Remaining: $remaining ---"
  if [ "$done" = "true" ]; then
    echo "All tracks resolved!"
    break
  fi
  sleep 5
done