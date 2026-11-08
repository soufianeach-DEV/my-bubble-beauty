#!/usr/bin/env bash
# Préparation unique du VPS OVH (Ubuntu 24.04) pour My Bubble Beauty : Node 22, Postgres 16, Caddy, pare-feu, sauvegardes.
# Usage, en root sur le VPS : bash setup.sh [branche]   (feat/reservation par défaut)
# Rejouable sans dégât : rien n'est écrasé si déjà présent (mot de passe Postgres, fichier de secrets).
set -euo pipefail

REPO=https://github.com/soufianeach-DEV/my-bubble-beauty.git
BRANCH=${1:-feat/reservation}
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "Branche invalide : $BRANCH"; exit 1; }
RAW="https://raw.githubusercontent.com/soufianeach-DEV/my-bubble-beauty/$BRANCH/deploy/vps"
APP=/srv/mybubble
ENV_FILE=/etc/mybubble/env

[ "$(id -u)" -eq 0 ] || { echo "À lancer en root (sudo -i)"; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] && [ "${VERSION_ID%%.*}" -ge 24 ] || { echo "Prévu pour Ubuntu 24.04 ou plus récent (trouvé : $PRETTY_NAME)"; exit 1; }

echo "== Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -yq upgrade
apt-get install -yq ca-certificates curl gnupg git ufw fail2ban unattended-upgrades postgresql postgresql-contrib debian-keyring debian-archive-keyring apt-transport-https

install -d -m 0755 /etc/apt/keyrings
# Node 22 (Ubuntu 24.04 ne fournit que Node 18) : dépôt signé NodeSource
if [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
fi
# Caddy : dépôt officiel signé
if [ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
fi
apt-get update -q
apt-get install -yq nodejs caddy
node -v | grep -q '^v22\.' || { echo "Node 22 attendu, trouvé $(node -v)"; exit 1; }

echo "== Mises à jour de sécurité automatiques"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Pare-feu : SSH, HTTP, HTTPS (et HTTP/3) seulement"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban

echo "== SSH : clés seulement (si une clé est déjà posée)"
# Sans clé posée, couper le mot de passe enfermerait l'admin dehors : on laisse alors SSH tel quel
if find /root/.ssh /home/*/.ssh -maxdepth 1 -name authorized_keys -size +0 2>/dev/null | grep -q .; then
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/10-mybubble.conf
  # Avant 50-cloud-init.conf : sshd garde la première valeur lue. Réglage refusé : retiré, pour ne pas bloquer le prochain démarrage
  sshd -t || { rm -f /etc/ssh/sshd_config.d/10-mybubble.conf; echo "Réglage SSH refusé par sshd, retiré"; exit 1; }
  systemctl reload ssh
else
  echo "Aucune clé SSH trouvée : mot de passe laissé actif. Poser une clé (ssh-copy-id) puis relancer setup.sh"
fi

echo "== Journaux système gardés 14 jours (durée annoncée dans la page confidentialité)"
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nMaxRetentionSec=14day\n' > /etc/systemd/journald.conf.d/mybubble.conf
systemctl restart systemd-journald

echo "== Utilisateur du site"
id mybubble >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin mybubble
install -d -o mybubble -g mybubble "$APP"
# Versions construites et lien « current » hors de tout dossier à mybubble : il ne peut ni les remplacer ni les détourner
install -d -m 0755 -o root -g root /opt/mybubble /opt/mybubble/releases
[ -d "$APP/repo/.git" ] || runuser -u mybubble -- git clone -q "$REPO" "$APP/repo"

echo "== Base Postgres (locale, joignable seulement depuis la machine)"
install -d -m 0750 -o root -g mybubble /etc/mybubble
if [ ! -f "$ENV_FILE" ]; then
  DB_PASSWORD=$(openssl rand -hex 24)
  runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -v pw="$DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE mybubble LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mybubble')\gexec
ALTER ROLE mybubble PASSWORD :'pw';
SELECT 'CREATE DATABASE mybubble OWNER mybubble' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mybubble')\gexec
SQL
  # Secrets : ce fichier n'existe que sur le VPS. Les valeurs vides sont à remplir à la main (voir LISEZMOI.md)
  umask 027
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres://mybubble:${DB_PASSWORD}@127.0.0.1:5432/mybubble
SITE_URL=https://mybubble-beauty.com
ADMIN_EMAIL=
# Reprendre les valeurs de Render si des comptes existent déjà : un autre poivre invalide tous les mots de passe
ADMIN_TOTP_SECRET=
PASSWORD_PEPPER=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
MAIL_FROM=My Bubble Beauty <rendez-vous@mybubble-beauty.com>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
EOF
  chown root:mybubble "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

echo "== Services : site, proxy, sauvegarde quotidienne"
# Jamais lus depuis $APP/repo : ce dossier appartient à mybubble, et le build y exécute le code des paquets npm.
# root les télécharge lui-même dans un dossier à lui (le relire sur GitHub avant de relancer setup.sh).
SRC=$(mktemp -d)
trap 'rm -rf -- "$SRC"' EXIT
for f in mybubble.service Caddyfile backup.sh deploy.sh; do curl -fsSL "$RAW/$f" -o "$SRC/$f"; done
install -m 0644 "$SRC/mybubble.service" /etc/systemd/system/mybubble.service
install -m 0644 "$SRC/Caddyfile" /etc/caddy/Caddyfile
install -m 0755 "$SRC/backup.sh" /usr/local/sbin/mybubble-backup
install -m 0755 "$SRC/deploy.sh" /usr/local/sbin/mybubble-deploy
install -d -m 0700 -o postgres -g postgres /var/backups/mybubble
cat > /etc/systemd/system/mybubble-backup.service <<'EOF'
[Unit]
Description=Sauvegarde de la base My Bubble
[Service]
Type=oneshot
User=postgres
ExecStart=/usr/local/sbin/mybubble-backup
EOF
cat > /etc/systemd/system/mybubble-backup.timer <<'EOF'
[Unit]
Description=Sauvegarde quotidienne de la base My Bubble (3 h 30)
[Timer]
OnCalendar=*-*-* 03:30:00 Europe/Brussels
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable mybubble.service
systemctl enable --now mybubble-backup.timer
systemctl reload caddy

echo
echo "Fini. Étapes suivantes (détail dans deploy/vps/LISEZMOI.md) :"
echo "  1. nano $ENV_FILE   (ADMIN_EMAIL, ADMIN_TOTP_SECRET, PASSWORD_PEPPER au minimum)"
echo "  2. mybubble-deploy $BRANCH"
