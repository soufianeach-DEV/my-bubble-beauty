#!/usr/bin/env bash
# Sauvegarde quotidienne de la base (timer mybubble-backup, 3 h 30), lancée par l'utilisateur postgres.
# Format personnalisé de pg_dump : restauration avec pg_restore (voir LISEZMOI.md). 14 jours gardés sur le VPS.
# shortcut: les copies restent sur le même disque que la base ; en rapatrier une chaque semaine (LISEZMOI.md) ou activer l'option de sauvegarde OVH.
set -euo pipefail

DIR=/var/backups/mybubble
FILE="$DIR/mybubble-$(date +%F).dump"

umask 077
# Copie interrompue (disque plein, base arrêtée) : le fichier partiel ne reste pas
trap 'rm -f -- "$FILE.part"' EXIT
pg_dump --format=custom --no-owner --file="$FILE.part" mybubble
mv "$FILE.part" "$FILE"
find "$DIR" -name 'mybubble-*.dump' -mtime +14 -delete
echo "Sauvegarde : $FILE ($(du -h "$FILE" | cut -f1))"
