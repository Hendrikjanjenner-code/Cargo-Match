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