-- Retour arrière de 012, à lancer à la main puis : DELETE FROM migrations WHERE name = '012_consentements.sql';
-- Les consentements signés et les réglages sont perdus : exporter la table consents avant.
DROP TABLE IF EXISTS consents;
DROP TABLE IF EXISTS settings;
