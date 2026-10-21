// @ts-check
import { defineConfig } from 'astro/config';

// Site statique déposé chez OVH (Apache) : aucune exécution côté serveur.
export default defineConfig({
  site: 'https://mybubble-beauty.com',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    // /fr/index.html et /fr/subPages/hifu.html : les URL de la v1 restent identiques (référencement)
    format: 'preserve',
    // La CSP n'autorise que 'self' : jamais de <style> en ligne
    inlineStylesheets: 'never',
  },
});
