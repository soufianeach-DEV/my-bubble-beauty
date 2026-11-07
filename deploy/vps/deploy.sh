#!/usr/bin/env bash
# Mise en ligne d'une version : installée par setup.sh sous le nom mybubble-deploy.
# Usage, en root : mybubble-deploy [branche]   (main par défaut)
# Chaque version est construite à part dans releases/<commit>, puis « current » bascule d'un coup.
# Si la page d'accueil ne répond pas dans les 30 s, retour automatique à la version précédente.
set -euo pipefail

BRANCH=${1:-main}
APP=/srv/mybubble
as_app() { runuser -u mybubble -- "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "À lancer en root (sudo mybubble-deploy)"; exit 1; }

as_app git -C "$APP/repo" fetch -q origin "$BRANCH"
SHA=$(as_app git -C "$APP/repo" rev-parse --short=12 FETCH_HEAD)
DEST="$APP/releases/$SHA"
echo "== Version $SHA ($BRANCH)"

if [ ! -f "$DEST/dist/server/entry.mjs" ]; then
  rm -rf "$DEST"
  as_app mkdir -p "$DEST"
  as_app sh -c "git -C '$APP/repo' archive FETCH_HEAD | tar -x -C '$DEST'"
  # Construction sans aucun secret : seules les pages publiques sont pré-rendues
  (cd "$DEST" && as_app env HOME="$APP" npm ci --no-audit --no-fund --loglevel=error && as_app env HOME="$APP" SITE_URL=https://mybubble-beauty.com npm run build --silent)
fi

PREV=$(readlink -f "$APP/current" 2>/dev/null || true)
ln -sfn "$DEST" "$APP/current.new" && mv -T "$APP/current.new" "$APP/current"
# Le service s'est peut-être mis à jour dans le dépôt : on recopie l'unité avant de redémarrer
install -m 0644 "$DEST/deploy/vps/mybubble.service" /etc/systemd/system/mybubble.service
systemctl daemon-reload
systemctl restart mybubble

for _ in $(seq 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:10000/fr/index.html; then
    echo "En ligne : $SHA"
    # On garde les 3 dernières versions pour un retour arrière manuel
    ls -1dt "$APP"/releases/*/ | tail -n +4 | xargs -r rm -rf
    exit 0
  fi
  sleep 1
done

echo "La nouvelle version ne répond pas. Dernières lignes du journal :"
journalctl -u mybubble -n 30 --no-pager || true
if [ -n "$PREV" ] && [ "$PREV" != "$DEST" ]; then
  ln -sfn "$PREV" "$APP/current.new" && mv -T "$APP/current.new" "$APP/current"
  systemctl restart mybubble
  echo "Retour à la version précédente : $(basename "$PREV")"
fi
exit 1
