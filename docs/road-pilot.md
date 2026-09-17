# Wegtransport — handmatige proefketen

Wegtransport is een aparte **pilot**, naast binnenvaart en deepsea. De pilot
verbindt een toekomstige vrije voertuigcapaciteit met een volgende lading.
`CONNECTED` betekent wederzijdse toestemming voor contact en overleg: geen
boeking, reservering, contract of transportbevestiging.

## Werkwijze

1. Een planner maakt een voertuig, trekker, trailer of combinatie aan.
2. De planner legt de huidige levering, verwachte afronding en toekomstige
   vrije locatie en tijd vast, met een expliciete onzekerheidsmarge.
3. De planner publiceert de werkelijk beschikbare tonnen, kubieke meters,
   laadmeters en palletplaatsen. Het aanbod mag de fysieke voertuiglimieten
   niet overschrijden.
4. Een verlader publiceert een volgende lading met locatie, tijdvenster,
   afmetingen en materieel-, temperatuur- en ADR-eisen.
5. Geschikte partijen zien een afgeschermde match. Alleen na wederzijdse
   interesse worden contactgegevens en een privégesprek toegankelijk.

Alle opgegeven capaciteitslimieten gelden tegelijk. De road-score is een
eigen voorlopige beoordeling, niet de binnenvaart- of deepsea-score. Afstand
is indicatief; rijtijd, verkeerssituatie, wettelijke rij- en rusttijden en
de daadwerkelijke uitvoerbaarheid moeten partijen zelf controleren.

## Chauffeur en planner

In deze pilot hebben actieve bedrijfsleden met de rol OWNER of ADMIN
commerciële plannerrechten. MEMBER is een operationele rol voor een
toegewezen chauffeur. Toewijzing is geen overdracht van commerciële rechten.

Een chauffeur ziet toegewezen werk en afgeschermde volgende-ladingkansen,
kan operationele status bevestigen en een kans aan de planner doorgeven.
Die bevestiging wijzigt geen commerciële capaciteit en accepteert geen
introductie. Wegtransportgesprekken en wederzijdse acceptatie blijven bij
de bevoegde planners. Het bredere uitnodigings- en samenwerkingsbeheer is
een afzonderlijke productuitbreiding.

## Herkomst en beperkingen

- Handmatige plannerinput is een verwachting, geen onafhankelijk bewijs.
- GPS of stilstaan bewijst niet dat een voertuig leeg of commercieel vrij is.
- Er is geen telemetrieleverancier geactiveerd, geen nieuw abonnement en
  geen externe telemetrie opgehaald.
- De providerinterface is leveranciersneutraal. Een echte connector vereist
  afzonderlijk toegestane toegang en controle van gebruiksrechten.
- Geen multimodale reisorkestratie.

## Beheer

De bestaande opslag en gedeelde toestemmingsketen blijven intact.
De additieve migratie staat in
`lib/db/migrations/0005_road_freight_vertical.sql`, met operationele meldingen in
`lib/db/migrations/0006_road_operational_flags.sql`. Beide worden door de
post-merge-installatie uitgevoerd. API-contract en veldnamen staan in
`lib/api-spec/openapi.yaml` en `docs/road-contract.md`.