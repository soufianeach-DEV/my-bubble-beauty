#!/usr/bin/env bash
# Sauvegarde chiffrée de la base : pg_dump du schéma public, chiffré à la volée pour une clé publique GPG.
# Le dump en clair ne touche jamais le disque : seule la sortie chiffrée est écrite.
# Usage : DATABASE_URL=… GPG_PUBLIC_KEY_FILE=cle.asc bash scripts/sauvegarde.sh sortie.dump.gpg
# PG_DUMP (facultatif) : commande pg_dump à utiliser (le workflow passe un pg_dump 17 en conteneur).
# Restauration : docs/exploitation.md.
set -euo pipefail

OUT=${1:?fichier de sortie attendu}
: "${DATABASE_URL:?DATABASE_URL manquant}"
: "${GPG_PUBLIC_KEY_FILE:?GPG_PUBLIC_KEY_FILE manquant}"
read -r -a PG_DUMP <<< "${PG_DUMP:-pg_dump}"

umask 077
# Schéma public seulement : les schémas internes de Supabase (auth, storage…) ne servent pas au site
# et ne se restaurent pas dans une base Postgres ordinaire. Sans propriétaires ni droits : restaurable partout.
"${PG_DUMP[@]}" --format=custom --compress=6 --schema=public --no-owner --no-privileges "$DATABASE_URL" \
  | gpg --batch --yes --quiet --trust-model always --recipient-file "$GPG_PUBLIC_KEY_FILE" --encrypt --output "$OUT"

# pipefail : un pg_dump en échec fait échouer le script. Un fichier minuscule trahit quand même un dump vide.
size=$(wc -c < "$OUT")
if [ "$size" -lt 1024 ]; then
  echo "Sauvegarde suspecte : $size octets"
  exit 1
fi
echo "Sauvegarde chiffrée : $OUT ($size octets)"
