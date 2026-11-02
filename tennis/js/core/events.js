/**
 * events.js - ATP event tier of a Match Charting Project tournament.
 *
 * MCP records only the tournament name, so the tier is derived from a hand-checked table of the
 * names present in the bundled extract (2022-10-31 to 2026-05-21). Tiers follow the ATP calendar
 * of the match year: Doha and Munich became ATP 500 in 2025, Dallas in 2026, and Astana was an
 * ATP 500 only in 2022. Names ending in " CH" are Challengers. Exhibitions (Six Kings Slam,
 * Next Gen Finals), national championships, juniors, ITF and college events fall in "Other".
 *
 * Pure module (no DOM, no D3).
 *
 * @module core/events
 */

/** Tier vocabulary in display order. */
export const EVENT_TIERS = Object.freeze([
  "Grand Slam",
  "ATP Finals",
  "Masters 1000",
  "ATP 500",
  "ATP 250",
  "Team & Olympics",
  "Challenger",
  "Other",
]);

const GRAND_SLAMS = new Set(["Australian Open", "Roland Garros", "Wimbledon", "US Open"]);

const MASTERS = new Set([
  "Indian Wells Masters", "Miami Masters", "Monte Carlo Masters", "Madrid Masters", "Rome Masters",
  "Canada Masters", "Cincinnati Masters", "Shanghai Masters", "Paris Masters",
  // Masters charted under the bare city name.
  "Madrid", "Rome", "Cincinnati",
]);

const ATP_500 = new Set([
  "Rotterdam", "Rio de Janeiro", "Acapulco", "Dubai", "Barcelona", "Halle", "Queens Club",
  "Hamburg", "Washington", "Beijing", "Tokyo", "Vienna", "Basel",
]);

/** ATP 500 from the given year on (ATP 250 before). */
const ATP_500_FROM = new Map([["Doha", 2025], ["Munich", 2025], ["Dallas", 2026]]);
/** ATP 500 only in the given years (ATP 250 otherwise). */
const ATP_500_IN = new Map([["Astana", new Set([2022])]]);

const ATP_250 = new Set([
  "Brisbane", "Adelaide", "Auckland", "Hong Kong", "Montpellier", "Marseille", "Buenos Aires",
  "Santiago", "Cordoba", "Delray Beach", "Los Cabos", "Estoril", "Marrakech", "Houston",
  "Bucharest", "Geneva", "Lyon", "Stuttgart", "s Hertogenbosch", "Mallorca", "Eastbourne",
  "Gstaad", "Bastad", "Newport", "Atlanta", "Umag", "Kitzbuhel", "Winston Salem", "Chengdu",
  "Hangzhou", "Almaty", "Stockholm", "Antwerp", "Brussels", "Athens", "Metz", "Belgrade",
  "Banja Luka", "Pune", "Doha", "Munich", "Dallas", "Astana",
]);

const TEAM = /^(Davis Cup|United Cup|Olympics$|Paris Olympics$)/;

/**
 * Tier of an event.
 * @param {string} tournament MCP tournament name, e.g. "Miami Masters", "Lugano CH"
 * @param {string|number} [date] match date "YYYYMMDD" (or a year); used for tier changes
 * @returns {string} one of EVENT_TIERS
 */
export function classifyEventTier(tournament, date) {
  const name = String(tournament || "").trim();
  if (!name) return "Other";
  const year = Number(String(date || "").slice(0, 4));
  if (GRAND_SLAMS.has(name)) return "Grand Slam";
  if (name === "Tour Finals") return "ATP Finals";
  if (MASTERS.has(name)) return "Masters 1000";
  if (/ CH$/.test(name)) return "Challenger";
  if (TEAM.test(name)) return "Team & Olympics";
  if (ATP_500_FROM.has(name)) return year >= ATP_500_FROM.get(name) ? "ATP 500" : "ATP 250";
  if (ATP_500_IN.has(name)) return ATP_500_IN.get(name).has(year) ? "ATP 500" : "ATP 250";
  if (ATP_500.has(name)) return "ATP 500";
  if (ATP_250.has(name)) return "ATP 250";
  if (name === "Luedenscheid") return "Challenger";
  return "Other";
}
