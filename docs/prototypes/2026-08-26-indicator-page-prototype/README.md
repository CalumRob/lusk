# Prototype #501 — page d'indicateur

Prototype jetable associé à l'issue #501 et à la PR #520. Ne pas fusionner.

## Lancer

```powershell
npm --prefix app run dev -- --host 127.0.0.1 --port 5181 --strictPort
```

Ajouter `?variant=A`, `?variant=B` ou `?variant=C` à l'une des routes :

- scalaire : `/indicateurs/demographie/densite`
- composition : `/indicateurs/habitat/mix_logements`
- distribution : `/indicateurs/habitat/distribution_dpe`
- trajectoire : `/indicateurs/habitat/prix_m2`

Les variantes sont A — Récit, B — Console et C — Atlas.

## Preuve d'activation

Chaque capture a été précédée d'une assertion sur `[data-proto="A|B|C"]` et
sur le libellé actif de `.v-btn.actif`. Les 15 assertions ont confirmé le couple
attendu (`A Récit`, `B Console` ou `C Atlas`). Le prototype est uniquement
disponible avec le serveur Vite de développement.

## Captures

Le dossier [`captures/`](captures/) contient :

- les trois variantes scalaires en bureau 1440 × 900 et mobile 390 × 844 ;
- les trois variantes en bureau pour les indicateurs de composition,
  distribution et trajectoire.
