# Mise en ligne sur le VPS OVH

Le site, le compte, la réservation, l'admin et la base Postgres tournent sur une seule machine.

```
Internet ─► Caddy (443, HTTPS automatique) ─► Node server.mjs (127.0.0.1:10000) ─► Postgres (127.0.0.1:5432)
```

| Élément | Où |
| --- | --- |
| Code | `/opt/mybubble/releases/<commit>`, version active : `/opt/mybubble/current` |
| Secrets | `/etc/mybubble/env` (jamais dans Git) |
| Sauvegardes | `/var/backups/mybubble/` (chaque nuit à 3 h 30, 14 jours) |
| Journaux | `journalctl -u mybubble` (gardés 14 jours) |

## 1. Avant de commencer

- Le domaine `mybubble-beauty.com` doit être actif chez OVH. Vérifie qu'il n'a pas expiré.
- Ta clé SSH doit être posée sur le VPS. Si tu as choisi la clé à la commande, c'est fait. Sinon : `ssh-copy-id ubuntu@IP_DU_VPS`.
- Note l'IPv4 (et l'IPv6) du VPS dans l'espace client OVH.
- Les fichiers de `deploy/vps/` doivent être poussés sur GitHub : le VPS les télécharge de là.

## 2. Préparer la machine (une seule fois)

```bash
ssh ubuntu@IP_DU_VPS
sudo -i
curl -fsSLO https://raw.githubusercontent.com/soufianeach-DEV/my-bubble-beauty/feat/reservation/deploy/vps/setup.sh
less setup.sh        # le relire avant de le lancer
bash setup.sh
```

Le script installe Node 22, Postgres 16 et Caddy. Il ferme tous les ports sauf SSH, 80 et 443. Il crée la base et son mot de passe, puis programme la sauvegarde de la nuit.

## 3. Remplir les secrets

```bash
nano /etc/mybubble/env
```

`DATABASE_URL` et `SITE_URL` sont déjà remplis. Copie les autres valeurs depuis Render (Environment du service).

- `PASSWORD_PEPPER` et `ADMIN_TOTP_SECRET` doivent être **exactement** ceux de Render. Avec un autre poivre, plus aucun mot de passe existant ne marche.
- Une variable laissée vide est ignorée (Stripe, Google et Microsoft sont facultatifs).
- Le site refuse de démarrer sans `ADMIN_EMAIL`, `ADMIN_TOTP_SECRET` et `PASSWORD_PEPPER`.

## 4. Reprendre les données de Supabase (si la base contient déjà des comptes)

À faire **avant** le premier déploiement, sinon le site crée une base vide.

```bash
# Supabase > Connect > Session pooler, adresse complète avec ?sslmode=require
pg_dump --format=custom --no-owner --no-privileges --schema=public "ADRESSE_SUPABASE" -f /tmp/supabase.dump
pg_restore --no-owner -d "$(grep ^DATABASE_URL /etc/mybubble/env | cut -d= -f2-)" /tmp/supabase.dump
rm /tmp/supabase.dump
```

Si `pg_dump` se plaint d'un serveur plus récent, installe le client de la même version : `apt install postgresql-client-17`, puis `/usr/lib/postgresql/17/bin/pg_dump`.

## 5. Mettre en ligne

```bash
mybubble-deploy feat/reservation      # plus tard : mybubble-deploy main
```

Le script construit la version à part, bascule, puis vérifie que la page d'accueil répond. Si elle ne répond pas, il revient tout seul à la version précédente.

Test avant de toucher au DNS, depuis le VPS : `curl -I http://127.0.0.1:10000/fr/index.html` doit répondre `200`.

## 6. Basculer le domaine

Chez OVH, dans la zone DNS de `mybubble-beauty.com` :

| Type | Sous-domaine | Cible |
| --- | --- | --- |
| A | (vide) | IPv4 du VPS |
| A | www | IPv4 du VPS |
| AAAA | (vide) et www | IPv6 du VPS |

Supprime les anciens enregistrements qui pointent vers Render. Ne touche pas aux lignes `MX`, `mail` et `TXT` : ce sont les e-mails et Resend.

Dès que le DNS répond, Caddy obtient le certificat HTTPS tout seul (`journalctl -u caddy -f` pour suivre).

## 7. Après la bascule

- **Pages légales** : remplacer Render et Supabase par OVH dans `src/data/legal.ts` (trois langues). Il faut la raison sociale d'OVH, son adresse et la ville du datacenter du VPS. Les journaux sont maintenant gardés 14 jours.
- **Stripe, Google, Microsoft, Resend** : rien à changer, le domaine reste le même. Une adresse de retour `onrender.com` éventuelle peut être retirée chez Google et Microsoft.
- **Render et Supabase** : les arrêter seulement après quelques jours sans souci.

## Tous les jours

| Besoin | Commande |
| --- | --- |
| Mettre à jour le site | `sudo mybubble-deploy main` |
| Voir les erreurs | `journalctl -u mybubble -n 100` |
| Redémarrer | `sudo systemctl restart mybubble` |
| Revenir à une version | `ls /opt/mybubble/releases`, puis `ln -sfn /opt/mybubble/releases/<commit> /opt/mybubble/current && systemctl restart mybubble` |
| Sauvegarde tout de suite | `sudo systemctl start mybubble-backup` |
| `mybubble.service` a changé dans le dépôt | le relire sur GitHub, puis `install -m 644 /opt/mybubble/current/deploy/vps/mybubble.service /etc/systemd/system/ && systemctl daemon-reload && systemctl restart mybubble` (jamais automatique : le build exécute du code de paquets npm) |

## Sauvegardes

Les copies de la nuit sont sur le même disque que la base. Si le VPS est perdu, elles le sont aussi. Rapatrie-en une chaque semaine sur ton PC :

```bash
# Sur le VPS
sudo install -o ubuntu -m 600 /var/backups/mybubble/mybubble-AAAA-MM-JJ.dump /tmp/
# Sur le PC
scp ubuntu@IP_DU_VPS:/tmp/mybubble-AAAA-MM-JJ.dump .
```

L'option « Sauvegarde automatisée » d'OVH garde aussi une copie de tout le VPS hors de la machine.

Restaurer une sauvegarde (efface la base actuelle) :

```bash
systemctl stop mybubble
runuser -u postgres -- pg_restore --clean --if-exists --no-owner --role=mybubble -d mybubble /var/backups/mybubble/mybubble-AAAA-MM-JJ.dump
systemctl start mybubble
```
