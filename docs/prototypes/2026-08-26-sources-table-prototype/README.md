# Prototype #500 — table Sources

Prototype jetable associé à l'issue #500 et à la PR #519. Ne pas fusionner.

## Lancer

```powershell
npm --prefix app run dev -- --host 127.0.0.1 --port 5519 --strictPort
```

Endpoints :

- A — Registre colonnes : `http://127.0.0.1:5519/sources?variant=A`
- B — Dossiers dépliables : `http://127.0.0.1:5519/sources?variant=B`
- C — Sections par thème : `http://127.0.0.1:5519/sources?variant=C`

## Preuve d'activation

Les six captures montrent le bandeau `.proto-bandeau`, le commutateur fixé sur
la bonne variante et la note propre à chaque composant : `.var-a__note`,
`.var-b__note` ou `.var-c__note`. Le prototype est uniquement disponible avec
le serveur Vite de développement ; une prévisualisation de production affiche
la page normale.

## Captures pleine page

| Variante | Bureau 1440 × 900 | Mobile 375 × 812 |
|---|---|---|
| A — Registre | [capture](captures/variant-a-registre-desktop-1440x900.png) | [capture](captures/variant-a-registre-mobile-375x812.png) |
| B — Dossiers | [capture](captures/variant-b-dossiers-desktop-1440x900.png) | [capture](captures/variant-b-dossiers-mobile-375x812.png) |
| C — Sections | [capture](captures/variant-c-sections-desktop-1440x900.png) | [capture](captures/variant-c-sections-mobile-375x812.png) |
