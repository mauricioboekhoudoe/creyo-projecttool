// Builds the first update block (the current project plan) and checks it with the same validator the Worker uses.
import { writeFileSync } from "node:fs";
import { validateUpdate } from "../src/update.js";

const P = (id, name, sort, note = "") => ({ id, name, sort, note });
let n = 0;
const I = (id, phase_id, title, owner, status, priority, why, next = "", waits_for = "") => ({
  id, phase_id, title, owner, status, priority, why, next, waits_for, sort: ++n,
});

const update = {
  format: "creyo-update/1",
  note: "Startinhoud: het projectplan van 12 oktober",
  meta: {
    headline: "Get Creyo, waar we staan",
    goal: "Pro+ is live en de koopflow is bewezen. Nu: eerlijke cijfers op dashboard en mediakit (F21 tot F25) en de afgewezen InsightIQ-webhooks (F10), daarna robuustheid (fase R). Merken en partners pas als F10 en R1 tot R3 staan.",
  },
  phases: [
    P("A", "Pro+ live", 1),
    P("A2", "Bevindingen uit de Pro+-test", 2),
    P("M", "Monitoring en advies", 3, "Na F10, eerst een mockup"),
    P("R", "Robuustheid", 4, "Start na F10"),
    P("B", "Merkenproduct", 5, "Bouwen pas na F10 en R1 tot R3"),
    P("C", "Partnerprogramma", 6, "Bouwen pas na F10 en R1 tot R3"),
    P("D", "Technisch onderhoud", 7),
    P("E", "Nazorg", 8),
  ],
  items: [
    I("A1", "A", "Pro+-pakket deel 1: verified data in de export, opruimen na 30 dagen, bewaking", "M", "done", 2, "Basis voor Pro+."),
    I("A2", "A", "Pro+-pakket deel 2: InsightIQ-kaart en foutmeldingen in het command center", "M", "done", 2, "Basis voor Pro+."),
    I("A3", "A", "Mail aan de creator bij een verlopen koppeling", "M", "done", 2, "Creator weet wanneer opnieuw koppelen nodig is."),
    I("A4", "A", "Verwerkersovereenkomst met InsightIQ opvragen, nalezen en tekenen", "C", "wait", 2, "Nodig voor de AVG: InsightIQ verwerkt gegevens van onze klanten.", "Mail aan InsightIQ versturen.", "Antwoord van InsightIQ"),
    I("A5", "A", "Juridische review van de Engelse teksten", "C", "open", 2, "Phyllo/InsightIQ en Klaviyo als verwerker, en de bewaartermijnen, moeten kloppen in de privacytekst.", "Review plannen."),
    I("A6", "A", "Appnaam in het koppelvenster: Sample App wordt Get Creyo", "M", "open", 3, "Klanten moeten zien dat ze aan Get Creyo toestemming geven.", "Nagaan of dit al klaar is: het venster toont al het logo."),
    I("A7", "A", "Pro+ klaarzetten: productiesleutels, webhook, Stripe-prijs, upgrade-knop", "M", "done", 1, "Voorwaarde om Pro+ te verkopen."),
    I("A8", "A", "Pro+ aanzetten", "M", "done", 1, "Live, verkoop staat aan; koopflowtest afgerond 11 okt."),

    I("F1", "A2", "Koppelvenster geblokkeerd voor TikTok, Instagram en Facebook", "M", "done", 1, "De beveiligingsregel van andere pagina's bleef gelden na een paginawissel.", "Klaar, live en getest 10 okt."),
    I("F2", "A2", "Instagram toonde geen verified data meer na opnieuw koppelen", "M", "done", 1, "Ontkoppelen wiste de data; InsightIQ stuurt bij opnieuw koppelen geen data opnieuw.", "Klaar: bij elke koppeling halen we de data zelf op (5134a1f)."),
    I("F3", "A2", "TikTok: shares leeg en lifetime likes niet aangesloten", "M", "open", 2, "Shares: waarschijnlijk te weinig posts binnen (2). Lifetime likes is nooit aangesloten.", "Meenemen bij F25."),
    I("F4", "A2", "Facebook-filter toont Pro+ en doet niets bij klikken", "M", "open", 2, "Facebook heeft geen gemeten laag; het filter kent alleen gemeten platforms.", "Meenemen in het dashboardvoorstel (F21)."),
    I("F5", "A2", "Label Pro+ in development naast de naam", "M", "done", 3, "Label stond er nog terwijl Pro+ verkocht wordt.", "Klaar, live 10 okt."),
    I("F6", "A2", "Een Pro+-klant moet zijn accounts twee keer koppelen: verified en gemeten", "M", "open", 2, "Twee losse koppelingen. Voorstel: na verified koppelen hetzelfde account automatisch laten meten.", "Bekijken met Charona's account.", "Besluit Mauricio en Charona"),
    I("F7", "A2", "Betaling van 14,90 op 7 okt op een opgezegd Pro-abonnement van Charona", "M", "open", 2, "Oorzaak nog onbekend; mogelijk terugbetalen.", "Tijdlijn van het abonnement en de webhook-meldingen in Stripe bekijken."),
    I("F8", "A2", "Prijspagina met Pro+-koopknop en upgrade-venster", "M", "done", 1, "Pro+ verkoopbaar maken.", "Klaar, koopflowtest afgerond 11 okt."),
    I("F9", "A2", "Upgrade-venster gaf een 500-fout", "M", "done", 1, "Testabonnement uit testmodus en geen foutafhandeling.", "Klaar: nette melding en regel in de error log (e062b24)."),
    I("F10", "A2", "InsightIQ-webhooks afgewezen op de handtekening (13 keer sinds 9 okt)", "M", "open", 1, "Updates van geverifieerde data kunnen verloren gaan. De ophaalactie bij het koppelen kan dit verbergen.", "Onderzoek: welke webhooks staan bij InsightIQ en met welke sleutel controleren we."),
    I("F11", "A2", "Inlogwaarschuwingen no_code en exchange_failed op 10 okt", "M", "open", 2, "Verlopen inloglink of een echt inlogprobleem.", "Onderzoeken na F10."),
    I("F12", "A2", "Ontbrekend label in het command center", "M", "open", 3, "Twee waarschuwingen missing_label op 10 okt.", "Klein, later."),
    I("F13", "A2", "Productie gebruikt een cache-bucket met staging in de naam", "M", "open", 2, "Mogelijk delen review en productie een cache. Timing bij F19 bleek geen cachefout.", "Uitzoeken met bewijs."),
    I("F14", "A2", "Free-account: filter Instagram lijkt aanklikbaar maar is het niet", "M", "open", 3, "Bewuste beperking voor Free, maar zonder slot of Pro-label.", "Meenemen in het dashboardvoorstel (F21)."),
    I("F15", "A2", "Stripe Checkout toont Basic abonnement onder Pro", "M", "open", 3, "Nederlandse omschrijving en verkeerde plannaam in Stripe.", "Productomschrijving in Stripe aanpassen, ook Pro+ nakijken."),
    I("F16", "A2", "Geen iDEAL in de checkout", "M", "open", 1, "Veel Nederlandse creators hebben geen creditcard.", "Nagaan of iDEAL met SEPA-incasso aan kan voor abonnementen; samen met F17."),
    I("F17", "A2", "Btw: Stripe berekent geen btw en de factuur toont geen btw-nummer of KvK", "C", "wait", 2, "De prijzen zijn inclusief btw. Advies: Stripe Tax Basic.", "Daarna btw-nummer, KvK en Stripe Tax inrichten, samen met F16.", "Bevestiging van Boekhoudoe over KOR, OSS en de drempel"),
    I("F18", "A2", "Upgrade naar Pro+ faalde door een prijs-ID uit testmodus", "M", "done", 1, "De Pro+-prijs in Cloudflare kwam uit testmodus.", "Klaar: alle 7 prijzen OK en bewaakt in het command center."),
    I("F19", "A2", "Na de upgrade toonde het dashboard nog Pro", "M", "done", 2, "Het dashboard wachtte op de webhook.", "Klaar: direct vastleggen en welkomstvenster (90c282d)."),
    I("F20", "A2", "Pro+ zonder betalen mogelijk bij een openstaande 3D Secure-betaling", "M", "done", 1, "Stripe zette de prijs al om; de webhook gaf dan Pro+.", "Klaar: upgrade pas na betaling (dbc3288)."),
    I("F21", "A2", "Dashboard: zes koppelknoppen, teksten door elkaar en voorbeeldcijfers bij echte klanten", "M", "open", 2, "Echte Pro+-klanten zien verzonnen cijfers. In strijd met de kwaliteitslat.", "Voorstel met mockup: een koppelroute via de Verified-pagina en eerlijke lege vakken."),
    I("F22", "A2", "Pro+-label is grijs zonder vinkje, Pro is geel met vinkje", "M", "open", 3, "Bewuste keuze uit de tijd dat Pro+ nog niet te koop was.", "Opnieuw beslissen in de mockup van F21."),
    I("F23", "A2", "Vóór de aankoop melden dat Instagram een creator- of business-account nodig heeft", "M", "busy", 1, "Met een persoonlijk account kun je Pro+ kopen maar niets koppelen.", "Bij Claude Code; daarna release met de kwaliteitslat en D7."),
    I("F24", "A2", "Koppelvenster toont twaalf platforms, waaronder X, Twitch en Instagram drie keer", "M", "open", 2, "Klanten kunnen iets koppelen dat we niet tonen.", "Nagaan in de code en de InsightIQ-instellingen; meenemen bij F21."),
    I("F25", "A2", "Saves, shares en bereik per post tonen op dashboard en mediakit", "M", "busy", 1, "Feedback Charona 12 okt. Pro+ belooft Real reach per post en Saves and shares.", "Onderzoek bij Claude Code: welke cijfers per post komen binnen. Daarna mockup."),

    I("M0", "M", "Mockup van het issue-overzicht en het detailvenster", "M", "open", 2, "De error log toont losse regels zonder uitleg; F10 zagen we pas een dag later.", "", "Koopflowtest en F10"),
    I("M1", "M", "Issues in plaats van regels, met uitleg en een kant-en-klare prompt per foutcode", "M", "open", 2, "Sneller zien wat er mis is en wat je moet doen.", "", "M0 goedgekeurd"),
    I("M2", "M", "Signalen: een error direct per mail, een dagelijkse samenvatting", "M", "open", 2, "Problemen komen bij ons binnen voordat een klant ze meldt.", "", "M1"),
    I("M3", "M", "Adviserende agent op het command center", "M", "open", 3, "Dagelijkse duiding van open issues.", "", "M1, M2"),

    I("R1", "R", "Instellingen automatisch controleren: alle sleutels en ID's, live en test nooit door elkaar", "M", "open", 1, "Een test-ID in productie blokkeerde Pro+ (F18).", "", "F10"),
    I("R2", "R", "Geldstromen automatisch testen vóór elke release met Stripe-testkaarten", "M", "open", 1, "De koopflow was nooit van begin tot eind getest; F20 had zo nooit live gestaan.", "", "R1"),
    I("R3", "R", "Nachtelijke vergelijking van Stripe, InsightIQ en onze database", "M", "open", 1, "Vangt elke gemiste webhook op.", "", "R1"),
    I("R4", "R", "Waarschuwen in plaats van alleen loggen (zelfde als M2)", "M", "open", 2, "Zelfde doel als M2.", "", "M1"),

    I("B1", "B", "Gesprekshandleiding met de drie vragen en een vaste manier van vastleggen", "M", "open", 2, "Voorbereiding op de gesprekken met merken.", "Kan nu."),
    I("B2", "B", "Vijf gesprekken met merken die we al kennen", "C", "open", 2, "Bewijs ophalen voordat we het merkenproduct bouwen.", "", "B1"),
    I("B3", "B", "Go of no-go op basis van de antwoorden", "M", "wait", 2, "Samen beslissen.", "", "B2"),
    I("B4", "B", "Mockup van stap 1: de knop op de kit en de mail aan de creator", "M", "open", 3, "Merken vragen creators om verificatie.", "Kan nu."),
    I("B5", "B", "Stap 1 bouwen: merken vragen creators om verificatie", "M", "wait", 2, "", "", "B3 (go), F10, R1 tot R3"),
    I("B6", "B", "Stap 2: de merkomgeving (shortlist, vergelijken, doelgroepmatch)", "M", "wait", 3, "", "", "Resultaat van stap 1"),
    I("B7", "B", "Stap 3: campagnerapport en omgeving voor bureaus", "M", "wait", 3, "", "", "Stap 2"),

    I("C1", "C", "Akkoord op het partnervoorstel (10% korting, 20% commissie, 12 maanden)", "C", "open", 2, "Startpunt voor het partnerprogramma."),
    I("C2", "C", "Twee of drie eerste partners kiezen", "C", "wait", 2, "", "", "C1"),
    I("C3", "C", "Eigen kortingscode per partner in Stripe", "M", "wait", 2, "", "", "C2"),
    I("C4", "C", "Maandelijkse uitbetaling, facturen en btw inrichten met Boekhoudoe", "C", "wait", 2, "", "", "C1"),
    I("C5", "C", "Proef van drie maanden, daarna stoppen, doorgaan of opschalen", "M", "wait", 3, "Samen beslissen.", "", "C3, C4"),

    I("D1", "D", "Grote Dependabot-updates, één per keer: TypeScript 7, vitest 5, eslint 10", "M", "open", 3, "Bijblijven zonder grote sprongen."),
    I("D2", "D", "Platformfilter op de kit sneller maken", "M", "open", 3, ""),
    I("D3", "D", "Omschrijving van de source-map-js-fix in DECISIONS.md rechtzetten", "M", "open", 3, ""),
    I("D4", "D", "De vijf hoge meldingen uit npm audit uitzoeken", "M", "open", 2, ""),
    I("D5", "D", "Telling van de staging-limiet op de InsightIQ-kaart gelijktrekken", "M", "open", 3, ""),
    I("D7", "D", "Instabiele test: klok vastzetten in de webhook-test", "M", "busy", 2, "Faalde soms op 1 milliseconde; ondermijnt het vertrouwen in de controle.", "Bij Claude Code, samen met F23."),

    I("E1", "E", "Hersteloefening: de database terugzetten volgens het runbook", "M", "open", 2, "Weten dat een back-up echt werkt."),
    I("E2", "E", "Beveiligingsaudit: toegang tussen klanten, opslag, sleutels in git, aanvalstest, headers", "M", "open", 2, ""),
    I("E3", "E", "Tweestapsverificatie op alle beheeraccounts", "M", "open", 1, "Supabase, Stripe, Cloudflare, GitHub, Apify, InsightIQ, Resend, Klaviyo. Mauricio en Charona."),
    I("E4", "E", "Bescherming op de tabel users uitbreiden met het plan-veld, plus een test", "M", "open", 2, ""),
    I("E5", "E", "Statuspagina, browsertests, RLS voor het merkenproduct, documentatieronde, middleware naar proxy", "M", "open", 3, ""),
  ],
  log: [
    { date: "2026-09-29", title: "Verified laag live", what: "Doelgroepdata in dashboard en mediakit, met bewezen isolatie tussen klanten.", why: "De kern van Pro+.", result: "Live." },
    { date: "2026-09-30", title: "Mediakit ronde 1 en 2 en reparaties", what: "Elk getal hooguit twee keer, geen gecombineerd percentage, top posts en verified per platform. Engagement rate en thumbnails gerepareerd.", why: "Eerlijke en leesbare kit.", result: "Live." },
    { date: "2026-10-02", title: "Dashboard per platform en Charona op Pro+", what: "Engagement per platform op het dashboard. Charona kreeg gratis Pro+ zonder abonnement.", why: "Demo's voor merken.", result: "Live." },
    { date: "2026-10-07", title: "Pro+-pakket en beveiligingsupdates", what: "Verified data in de export, opruimen na 30 dagen, InsightIQ-kaart, mail bij verlopen koppeling. Next.js en andere pakketten gepatcht.", why: "Pro+ klaarmaken en bekende lekken dichten.", result: "Live.", item_ids: ["A1", "A2", "A3"] },
    { date: "2026-10-09", title: "Pro+ live", what: "InsightIQ-productiesleutels, verkoop aangezet.", why: "Charona wil Pro+ gaan verkopen en demonstreren.", result: "Pro+ te koop.", item_ids: ["A7", "A8"] },
    { date: "2026-10-10", title: "Koppelen hersteld", what: "Het koppelvenster werd geblokkeerd en opnieuw koppelen gaf geen data. Beide opgelost, data van Charona teruggehaald.", why: "Charona kon Instagram en TikTok niet koppelen.", result: "Instagram weer 1 profiel, 1 doelgroep, 37 posts.", item_ids: ["F1", "F2"] },
    { date: "2026-10-10", title: "Kwaliteitslat vastgesteld", what: "Acht punten waar elke wijziging aan voldoet, ook vastgelegd voor Claude Code.", why: "State of the art, niets minder.", result: "Claude Code meldt nu zelf wat het buiten de opdracht tegenkomt." },
    { date: "2026-10-10", title: "Upgrade naar Pro+ werkend en veilig", what: "Testprijs in productie vervangen, prijzen worden bewaakt, upgrade direct vastgelegd met welkomstvenster, Pro+ pas na betaling.", why: "Niemand kon upgraden, en er was een manier om Pro+ zonder betalen te krijgen.", result: "Live: alle 7 prijzen OK.", item_ids: ["F18", "F19", "F20"] },
    { date: "2026-10-11", title: "Koopflowtest afgerond", what: "Met een testaccount: Pro gekocht, geüpgraded naar Pro+, opgezegd en terugbetaald.", why: "Er had nog nooit iemand de hele route echt doorlopen.", result: "Werkt van begin tot eind. Zes nieuwe bevindingen (F21 tot F25, D7).", item_ids: ["F9", "F21", "F22", "F23", "F24"] },
    { date: "2026-10-12", title: "Feedback Charona over saves en shares", what: "Top posts en mediakit tonen alleen likes en comments.", why: "Pro+ belooft saves, shares en bereik per post.", result: "Bevinding F25, onderzoek klaargezet.", item_ids: ["F25"] },
  ],
};

const v = validateUpdate(update, { people: { M: {}, C: {} } });
if (!v.ok) {
  console.error(v.errors);
  process.exit(1);
}
writeFileSync(new URL("./initial-update.json", import.meta.url), JSON.stringify(update, null, 2));
console.log(`ok: ${update.phases.length} phases, ${update.items.length} items, ${update.log.length} log`);
