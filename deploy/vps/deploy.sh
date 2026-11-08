#!/usr/bin/env bash
# Mise en ligne d'une version : installée par setup.sh sous le nom mybubble-deploy.
# Usage, en root : mybubble-deploy [branche]   (main par défaut)
# Chaque version est construite à part dans /opt/mybubble/releases/<commit>, puis « current » bascule d'un coup.
# Si la page d'accueil ne répond pas dans les 30 s, retour automatique à la version précédente.
set -euo pipefail

BRANCH=${1:-main}
APP=/srv/mybubble          # à mybubble : dépôt git et cache npm
REL=/opt/mybubble          # à root : versions construites et lien « current », que mybubble ne peut ni remplacer ni détourner
# Code du dépôt et des paquets npm lancé dans une unité systemd à part, sous mybubble : sans le terminal de root (aucune frappe
# injectée dans sa session), sans accès aux secrets, et tous ses processus tués à la fin (aucun ne survit pour modifier la version figée).
# as_app --in DOSSIER cmd… : lancé dans DOSSIER (sinon $APP)
as_app() {
  local dir=$APP
  if [ "$1" = --in ]; then dir=$2; shift 2; fi
  systemd-run --quiet --wait --pipe --collect --uid=mybubble --gid=mybubble --working-directory="$dir" --setenv=HOME="$APP" \
    -p NoNewPrivileges=yes -p PrivateTmp=yes -p InaccessiblePaths=/etc/mybubble -- "$@"
}

[ "$(id -u)" -eq 0 ] || { echo "À lancer en root (sudo mybubble-deploy)"; exit 1; }
for d in "$REL" "$REL/releases"; do
  [ -d "$d" ] && [ ! -L "$d" ] && [ "$(stat -c %u "$d")" = 0 ] || { echo "$d doit être un vrai dossier à root (relancer setup.sh)"; exit 1; }
done

as_app git -C "$APP/repo" fetch -q origin "$BRANCH"
SHA=$(as_app git -C "$APP/repo" rev-parse --short=12 FETCH_HEAD)
# Le dépôt appartient à mybubble : on n'accepte qu'un vrai nom de commit avant de s'en servir comme chemin
[[ "$SHA" =~ ^[0-9a-f]{12}$ ]] || { echo "Commit inattendu : $SHA"; exit 1; }
DEST="$REL/releases/$SHA"
echo "== Version $SHA ($BRANCH)"

# Une version déjà construite n'est reprise que si elle est complète et entièrement à root ; sinon on la reconstruit
if [ ! -f "$DEST/dist/server/entry.mjs" ] || [ -n "$(find "$DEST" ! -user root -print -quit)" ]; then
  rm -rf -- "$DEST"
  install -d -o mybubble -g mybubble "$DEST"
  as_app sh -c "git -C '$APP/repo' archive FETCH_HEAD | tar -x -C '$DEST'"
  # Construction sans aucun secret (/etc/mybubble lui est inaccessible) : seules les pages publiques sont pré-rendues
  as_app --in "$DEST" npm ci --no-audit --no-fund --loglevel=error
  as_app --in "$DEST" env SITE_URL=https://mybubble-beauty.com npm run build --silent
fi
# Version figée à chaque mise en ligne : le site qui tourne ne peut plus modifier son propre code (-h : jamais à travers un lien)
chown -R -h root:mybubble "$DEST"
chmod -R go-w "$DEST"

PREV=$(readlink -f "$REL/current" 2>/dev/null || true)
ln -sfn "$DEST" "$REL/current.new" && mv -T "$REL/current.new" "$REL/current"
# Jamais d'unité systemd lue depuis la version : le build y a exécuté le code des paquets npm sous mybubble.
# Une modification de mybubble.service se pose à la main, après relecture (LISEZMOI.md).
systemctl restart mybubble

for _ in $(seq 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:10000/fr/index.html; then
    echo "En ligne : $SHA"
    # On garde les 3 dernières versions pour un retour arrière manuel
    find "$REL/releases" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9a-f]{12}' -printf '%T@ %p\n' \
      | sort -rn | tail -n +4 | cut -d' ' -f2- | xargs -r rm -rf --
    exit 0
  fi
  sleep 1
done

echo "La nouvelle version ne répond pas. Dernières lignes du journal :"
journalctl -u mybubble -n 30 --no-pager || true
if [ -n "$PREV" ] && [ "$PREV" != "$DEST" ]; then
  ln -sfn "$PREV" "$REL/current.new" && mv -T "$REL/current.new" "$REL/current"
  systemctl restart mybubble
  echo "Retour à la version précédente : $(basename "$PREV")"
fi
exit 1
