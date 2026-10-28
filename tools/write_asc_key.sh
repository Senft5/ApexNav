#!/usr/bin/env bash
# Writes the App Store Connect API key in $ASC_KEY_P8 to the file named in $1 as a PEM .p8.
# Accepts the .p8 as pasted (with BEGIN/END lines), the same with line breaks lost, just the base64 body with no
# BEGIN/END lines or line breaks (what a single-line secret form leaves), or base64 of the whole file.
set -euo pipefail
out="$1"
body=$(printf '%s' "$ASC_KEY_P8" | sed 's/-----[A-Z ]*-----//g' | tr -d ' \t\r\n')
# Base64 of the whole file decodes to text that has the BEGIN line: unwrap it once.
inner=$(printf '%s' "$body" | base64 --decode 2>/dev/null | tr -d '\0' || true)
if printf '%s' "$inner" | grep -q "BEGIN PRIVATE KEY"; then
  body=$(printf '%s' "$inner" | sed 's/-----[A-Z ]*-----//g' | tr -d ' \t\r\n')
fi
[ -n "$body" ] || { echo "ASC_KEY_P8 is empty" >&2; exit 1; }
{
  echo "-----BEGIN PRIVATE KEY-----"
  printf '%s' "$body" | fold -w 64
  echo
  echo "-----END PRIVATE KEY-----"
} > "$out"
chmod 600 "$out"
# A .p8 from Apple is a P-256 key; fail here with a clear message rather than deep inside xcodebuild.
if command -v openssl >/dev/null && ! openssl pkey -in "$out" -noout 2>/dev/null; then
  echo "ASC_KEY_P8 is not a valid private key after rebuilding the PEM; paste the .p8 file contents again" >&2
  exit 1
fi
