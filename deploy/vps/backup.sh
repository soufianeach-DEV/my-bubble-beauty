#!/usr/bin/env bash
# Sauvegarde quotidienne de la base (timer mybubble-backup, 3 h 30), lancée par l'utilisateur postgres.
# Format personnalisé de pg_dump : restauration avec pg_restore (voir LISEZMOI.md). 14 jours gardés sur le VPS.
# Chiffrée pour une clé GPG publique si /etc/mybubble-sauvegarde.asc existe : le dump en clair ne touche alors jamais le disque,
# et une copie volée (VPS, PC où elle est rapatriée) reste illisible sans la clé privée, gardée hors du VPS.
# shortcut: les copies restent sur le même disque que la base ; en rapatrier une chaque semaine (LISEZMOI.md) ou activer l'option de sauvegarde OVH.
set -euo pipefail

DIR=/var/backups/mybubble
KEY=/etc/mybubble-sauvegarde.asc
STAMP=$(date +%F)

umask 077
if [ -s "$KEY" ]; then
  FILE="$DIR/mybubble-$STAMP.dump.gpg"
  # Trousseau jetable : gpg n'écrit rien dans le dossier de postgres
  GNUPGHOME=$(mktemp -d)
  export GNUPGHOME
  trap 'rm -rf -- "$GNUPGHOME"; rm -f -- "$FILE.part"' EXIT
  pg_dump --format=custom --no-owner mybubble \
    | gpg --batch --yes --quiet --trust-model always --recipient-file "$KEY" --encrypt --output "$FILE.part"
else
  FILE="$DIR/mybubble-$STAMP.dump"
  trap 'rm -f -- "$FILE.part"' EXIT
  echo "ATTENTION : sauvegarde NON chiffrée, $KEY absent (voir LISEZMOI.md, Sauvegardes)" >&2
  pg_dump --format=custom --no-owner --file="$FILE.part" mybubble
fi
# Copie interrompue (disque plein, base arrêtée) : le fichier partiel ne reste pas (trap)
mv "$FILE.part" "$FILE"
find "$DIR" \( -name 'mybubble-*.dump' -o -name 'mybubble-*.dump.gpg' \) -mtime +14 -delete
echo "Sauvegarde : $FILE ($(du -h "$FILE" | cut -f1))"
