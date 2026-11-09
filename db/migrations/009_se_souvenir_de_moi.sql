-- « Se souvenir de moi » : session de 30 jours et cookie persistant, choisis par la cliente à la connexion (jamais pour l'admin)
ALTER TABLE sessions ADD COLUMN remember boolean NOT NULL DEFAULT false;
