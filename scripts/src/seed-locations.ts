import { db, locationsTable } from "@workspace/db";

const locations = [
  ["Rotterdam", "NL", "South Holland", 51.9244, 4.4777, "PORT"],
  ["Dordrecht", "NL", "South Holland", 51.8133, 4.6901, "PORT"],
  ["Moerdijk", "NL", "North Brabant", 51.7017, 4.6267, "INDUSTRIAL_AREA"],
  ["Amsterdam", "NL", "North Holland", 52.3676, 4.9041, "PORT"],
  ["Nijmegen", "NL", "Gelderland", 51.8426, 5.8372, "PORT"],
  ["Terneuzen", "NL", "Zeeland", 51.335, 3.827, "PORT"],
  ["Vlissingen", "NL", "Zeeland", 51.442, 3.573, "PORT"],
  ["Antwerp", "BE", "Flanders", 51.2194, 4.4025, "PORT"],
  ["Ghent", "BE", "Flanders", 51.0543, 3.7174, "PORT"],
  ["Duisburg", "DE", "North Rhine-Westphalia", 51.4344, 6.7623, "PORT"],
  ["Düsseldorf", "DE", "North Rhine-Westphalia", 51.2277, 6.7735, "PORT"],
  ["Cologne", "DE", "North Rhine-Westphalia", 50.9375, 6.9603, "PORT"],
  // Curated deepsea pilot fixtures. Coordinates are approximate port-area
  // points for eligibility bands only, not berth or navigable-route data.
  ["Singapore", "SG", "Singapore", 1.2644, 103.8200, "PORT"],
  ["Port Klang", "MY", "Selangor", 3.0000, 101.4000, "PORT"],
  ["Balikpapan", "ID", "East Kalimantan", -1.2675, 116.8289, "PORT"],
  ["Qingdao", "CN", "Shandong", 36.0671, 120.3826, "PORT"],
  ["Newcastle", "AU", "New South Wales", -32.9283, 151.7817, "PORT"],
  // Conventional liner pilot catalogue; approximate port-area points only.
  // Port identity/order, not coordinates, determines liner route compatibility.
  ["Bilbao", "ES", "Basque Country", 43.35, -3.05, "PORT"],
  ["Dakar", "SN", "Dakar Region", 14.68, -17.42, "PORT"],
  ["Tema", "GH", "Greater Accra", 5.63, 0.02, "PORT"],
] as const;

for (const [name, country, region, latitude, longitude, locationType] of locations) {
  await db
    .insert(locationsTable)
    .values({
      name,
      country,
      region,
      latitude,
      longitude,
      privacyLatitude: latitude,
      privacyLongitude: longitude,
      locationType,
    })
    .onConflictDoNothing();
}

await db.$client.end();