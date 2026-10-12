# Creyo projecttool

Gedeelde projecttool voor Get Creyo (Mauricio en Charona): taken en bevindingen, feedback met screenshots, logboek, en een sync met Claude via Beheer.

## Hoe het werkt

- Eén Cloudflare Worker serveert de pagina en de API. Gegevens staan in D1, screenshots in R2.
- Cloudflare Access staat voor het hele adres. De Worker controleert daarnaast zelf het Access-token van elke aanvraag en kent alleen de mensen uit `PEOPLE` in `wrangler.toml`. Zonder geldige login komt er niets terug, ook niet als Access verkeerd staat.
- Er staan geen sleutels in de pagina. Schrijven vereist dezelfde herkomst en een eigen header.
- Beheer (alleen beheerders): **Kopieer voor Claude** zet alle wijzigingen sinds de vorige export op het klembord. **Update van Claude** wordt eerst gecontroleerd, daarna toegepast. Elke toepassing bewaart de vorige stand als versie, en die kun je terugzetten. Feedback, reacties en screenshots van mensen worden nooit teruggezet.

## Lokaal draaien

```
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev                     # http://localhost:8787, ingelogd via DEV_AUTH_EMAIL
npm test                        # validatie van updates
node test/smoke.local.mjs       # end-to-end tegen de lokale Worker
```

`DEV_AUTH_EMAIL` werkt alleen op localhost, nooit op een echt adres.

## Eerste keer inrichten in Cloudflare

1. **D1:** maak database `creyo-projecttool`, zet de Database ID in `wrangler.toml`. Open de Console van de database en voer `migrations/0001_init.sql` uit.
2. **R2:** maak bucket `creyo-projecttool-files`.
3. **Access:** maak een self-hosted application voor het adres, met een policy die alleen de e-mailadressen uit `PEOPLE` toelaat, inloggen met een eenmalige code. Zet de team domain en de Application Audience (AUD) in `wrangler.toml`.
4. **Worker:** Workers, Create, Import a repository, kies deze repository. Daarna Settings, Domains & Routes, het eigen adres toevoegen.
5. Open het adres, log in, open **Beheer** en pas `seed/initial-update.json` toe.

## Een update van Claude

Een update is een JSON-blok met `"format": "creyo-update/1"`. Zie `src/update.js` voor alle velden en grenzen.
