-- Plus d'acompte en ligne : toutes les réservations sont confirmées sans paiement, la cliente règle au salon.
-- Le code Stripe reste en place, inutilisé ; les réservations déjà payées gardent leur acompte et leur remboursement.
UPDATE services SET deposit_cents = 0 WHERE deposit_cents <> 0;
