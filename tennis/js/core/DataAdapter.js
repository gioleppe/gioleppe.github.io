/**
 * DataAdapter.js - Data ingestion & normalization layer.
 *
 * Transforms raw Match Charting Project (MCP) rows (or arbitrary row objects
 * through a field map) into immutable CanonicalPointRecord objects, and ships a
 * deterministic synthetic fallback dataset so the dashboard works offline.
 *
 * This module is dependency-free and DOM-free: it runs unchanged in Node and
 * in the browser (see docs/api_contract.md and docs/implementation_guideline.md
 * sections 3.2 / 3.3).
 */

// ---------------------------------------------------------------------------
// Canonical vocabularies
// ---------------------------------------------------------------------------

export const SERVE_DIRS = ["Wide", "Body", "T"];
export const RETURN_DEPTHS = ["Shallow", "Deep", "VeryDeep", "Unreturned"];
export const THIRD_SHOTS = ["FH_InsideOut", "FH_Cross", "BH_Cross", "BH_Line", "Net_Drop", "Ace_SvcWin", "Other"];
export const RALLY_BUCKETS = ["1-4", "5-8", "9+"];
export const PRESSURE_STATES = ["Baseline", "BreakPoint", "GamePoint", "Tiebreak"];
import { classifyEventTier } from "./events.js";

export const SURFACES = ["Hard", "Clay", "Grass"];
export const TERMINAL_OUTCOMES = ["Winner", "ForcedError", "UnforcedError"];
/** rallyLength >= RALLY_CAP is displayed as "13+". */
export const RALLY_CAP = 13;

/**
 * @typedef {Object} CanonicalPointRecord
 * @property {string} pointId
 * @property {string} matchId
 * @property {"Hard"|"Clay"|"Grass"} surface
 * @property {string} serverName
 * @property {string} returnerName
 * @property {1|2} serveNumber
 * @property {"Deuce"|"Ad"} courtSide
 * @property {"Baseline"|"BreakPoint"|"GamePoint"|"Tiebreak"} pressureState
 * @property {"Wide"|"Body"|"T"} serveDirection
 * @property {"Shallow"|"Deep"|"VeryDeep"|"Unreturned"} returnDepth
 * @property {"FH_InsideOut"|"FH_Cross"|"BH_Cross"|"BH_Line"|"Net_Drop"|"Ace_SvcWin"|"Other"} thirdShotArchetype
 * @property {number} rallyLength   integer >= 1 (serve counts as shot 1; the final error shot is counted)
 * @property {"1-4"|"5-8"|"9+"} rallyBucket
 * @property {boolean} serverWon
 * @property {"Winner"|"ForcedError"|"UnforcedError"} terminalOutcome
 * @property {string} [date]        YYYYMMDD
 * @property {string} [tournament]
 * @property {string} [eventTier]   one of events.EVENT_TIERS (derived from tournament + date)
 * @property {string} [round]
 * @property {string} [serverHand]
 * @property {string} [returnerHand]
 * @property {string} [rawString]
 */

// ---------------------------------------------------------------------------
// MCP shot grammar
// ---------------------------------------------------------------------------

/** Serve direction digit -> canonical serve direction. */
const SERVE_DIR_BY_DIGIT = { 4: "Wide", 5: "Body", 6: "T" };
/** Return depth digit -> canonical return depth. */
const DEPTH_BY_DIGIT = { 7: "Shallow", 8: "Deep", 9: "VeryDeep" };
/** Terminal symbol -> canonical outcome. */
const OUTCOME_BY_SYMBOL = { "*": "Winner", "#": "ForcedError", "@": "UnforcedError" };

/**
 * Shot letters of the Layer-3 "Net_Drop" archetype, exactly as guideline section 3.3
 * lists them (v = FH volley, z = BH volley, o = overhead, u = FH drop shot). The other
 * net-family letters of the MCP grammar (p, y, h, i, j, k) still count for rallyLength
 * but map to "Other" ("all other combinations").
 */
const NET_FAMILY = new Set(["v", "z", "o", "u"]);
const FOREHAND_FAMILY = new Set(["f", "r"]);
const BACKHAND_FAMILY = new Set(["b", "s"]);

/**
 * Characters that carry no shot information: let markers (c), approach /
 * net-position / baseline modifiers (+ - =), stop-volley marker (^), net-cord
 * (;), charter annotations (! `), uppercase stoppage codes and whitespace.
 */
const NOISE_RE = /[\sc+\-=^;!`A-Z]/g;
const TERMINAL_RE = /[*#@]/;
/**
 * One shot token (type letter f b r s v z o p u y l m h i j k t q, optional direction 1-3,
 * optional depth 7-9) or one error letter (n w d x g e), matched sticky.
 */
const SHOT_TOKEN_RE = /([fbrsvzopuylmhijktq])([123])?([789])?|([nwdxge])/y;

/**
 * Strip non-shot characters from a raw MCP shot string (terminal symbols kept).
 * @param {unknown} str
 * @returns {string}
 */
function sanitizeMcpString(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(NOISE_RE, "");
}

/**
 * Tokenize the part of a sanitized string that follows the serve digit.
 * @param {string} body
 * @returns {{ ok: true, shots: Array<{type: string, dir: string|null, depth: string|null}>, errorLetter: string|null }
 *         | { ok: false, reason: string }}
 */
function tokenizeRally(body) {
  const shots = [];
  let errorLetter = null;
  let pos = 0;
  while (pos < body.length) {
    if (errorLetter !== null) return { ok: false, reason: "shotAfterError" };
    SHOT_TOKEN_RE.lastIndex = pos;
    const m = SHOT_TOKEN_RE.exec(body);
    if (!m) return { ok: false, reason: "invalidToken" };
    if (m[4]) {
      errorLetter = m[4];
    } else {
      shots.push({ type: m[1], dir: m[2] || null, depth: m[3] || null });
    }
    pos = SHOT_TOKEN_RE.lastIndex;
  }
  return { ok: true, shots, errorLetter };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const GAME_SCORE_VALUE = { 0: 0, 15: 1, 30: 2, 40: 3, AD: 4, A: 4 };

/**
 * Parse one side of a Pts cell into a point count usable for parity.
 * Game scores map 0/15/30/40/AD -> 0/1/2/3/4; tiebreak scores are plain integers.
 * @param {string} side
 * @returns {number|null}
 */
function scoreSideValue(side) {
  const s = side.trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(GAME_SCORE_VALUE, s)) return GAME_SCORE_VALUE[s];
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

/**
 * Split a Pts cell ("15-40", "AD-40", "3-4") into its two upper-cased sides.
 * @param {unknown} scoreStr
 * @returns {[string, string]|null}
 */
function splitScore(scoreStr) {
  if (typeof scoreStr !== "string") return null;
  const parts = scoreStr.trim().toUpperCase().split("-");
  if (parts.length !== 2) return null;
  return [parts[0].trim(), parts[1].trim()];
}

/**
 * Service court side derived from score parity: even point-sum => "Deuce", odd => "Ad".
 * Works for game scores (0/15/30/40/AD) and tiebreak scores (plain integers).
 * Unparseable input defaults to "Deuce".
 * @param {string} scoreStr  server score first
 * @returns {"Deuce"|"Ad"}
 */
export function deriveCourtSide(scoreStr) {
  const parts = splitScore(scoreStr);
  if (!parts) return "Deuce";
  const a = scoreSideValue(parts[0]);
  const b = scoreSideValue(parts[1]);
  if (a === null || b === null) return "Deuce";
  return (a + b) % 2 === 0 ? "Deuce" : "Ad";
}

const BREAK_POINT_SCORES = new Set(["0-40", "15-40", "30-40", "40-AD"]);
const GAME_POINT_SCORES = new Set(["40-0", "40-15", "40-30", "AD-40"]);

/**
 * Contextual leverage state of a point from the server's perspective.
 * In a tiebreak every point is "Tiebreak".
 * @param {string} scoreStr   server score first (e.g. "15-40", "AD-40")
 * @param {boolean} [isTiebreak=false]
 * @returns {"Baseline"|"BreakPoint"|"GamePoint"|"Tiebreak"}
 */
export function classifyPressureState(scoreStr, isTiebreak = false) {
  if (isTiebreak) return "Tiebreak";
  const parts = splitScore(scoreStr);
  if (!parts) return "Baseline";
  const key = parts.map((p) => (p === "A" ? "AD" : p)).join("-");
  if (BREAK_POINT_SCORES.has(key)) return "BreakPoint";
  if (GAME_POINT_SCORES.has(key)) return "GamePoint";
  return "Baseline";
}

/**
 * Ordinal rally bucket of a rally length. Returns null for invalid input.
 * @param {number} rallyLength
 * @returns {"1-4"|"5-8"|"9+"|null}
 */
export function rallyBucketOf(rallyLength) {
  if (!Number.isFinite(rallyLength) || rallyLength < 1) return null;
  if (rallyLength <= 4) return "1-4";
  if (rallyLength <= 8) return "5-8";
  return "9+";
}

/**
 * Whether a Pts cell holds plain tiebreak digits that cannot be a regular game score
 * (e.g. "3-4", "0-1", "10-9"; "0-0" is ambiguous and yields false).
 * @param {unknown} pts
 * @returns {boolean}
 */
function hasTiebreakScore(pts) {
  const parts = splitScore(pts);
  if (!parts) return false;
  const bothNumeric = /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]);
  const looksLikeGameScore = parts.every((p) => p === "0" || p === "15" || p === "30" || p === "40");
  return bothNumeric && !looksLikeGameScore;
}

/**
 * Detect whether a raw MCP points row belongs to a tiebreak: either the Pts cell holds
 * plain tiebreak digits (e.g. "3-4") or both game counts are equal and >= 6 in a
 * tiebreak set (TbSet not "False").
 * @param {Object} row  raw MCP row (Gm1, Gm2, Pts, TbSet)
 * @returns {boolean}
 */
function isTiebreakRow(row) {
  if (hasTiebreakScore(row.Pts)) return true;
  const g1 = Number(row.Gm1);
  const g2 = Number(row.Gm2);
  const tbSet = String(row.TbSet ?? "").trim().toLowerCase();
  return Number.isInteger(g1) && g1 === g2 && g1 >= 6 && tbSet !== "false";
}

/**
 * Game key of a raw MCP row (match, set score, game number), or null when incomplete.
 * @param {Object} row
 * @returns {string|null}
 */
function gameKeyOf(row) {
  const gm = String(row["Gm#"] ?? "").trim();
  if (!gm) return null;
  return `${String(row.match_id ?? "").trim()}|${String(row.Set1 ?? "").trim()}|${String(row.Set2 ?? "").trim()}|${gm}`;
}

/**
 * Collect the games (see gameKeyOf) in which at least one row carries a plain tiebreak
 * score. A tiebreak is decided at game level so that its "0-0" opener is labelled like the
 * rest of the game, including short-set formats (NextGen Finals: tiebreak at 3-3) where the
 * 6-6 rule of isTiebreakRow does not apply.
 * @param {Object[]} pointRows
 * @returns {Set<string>}
 */
function collectTiebreakGames(pointRows) {
  const games = new Set();
  for (const row of pointRows) {
    if (!row || !hasTiebreakScore(row.Pts)) continue;
    const key = gameKeyOf(row);
    if (key) games.add(key);
  }
  return games;
}

// ---------------------------------------------------------------------------
// Third-shot (serve + 1) archetype
// ---------------------------------------------------------------------------

/**
 * Map the server's third shot to a Layer-3 archetype (guideline section 3.3, literally).
 * f/r count as forehands, b/s as backhands, v/u/o/z as Net_Drop; every other letter or
 * letter/direction combination (lobs, half-volleys, swinging volleys, BH overheads,
 * shots without a direction digit, b2 ...) is "Other". The f1 ambiguity is resolved with
 * the service court side: a forehand hit to the deuce corner from the Ad side is
 * inside-out, from the Deuce side it is cross-court.
 * @param {{type: string, dir: string|null}} shot
 * @param {"Deuce"|"Ad"} courtSide
 * @returns {string}
 */
function classifyThirdShot(shot, courtSide) {
  const { type, dir } = shot;
  if (NET_FAMILY.has(type)) return "Net_Drop";
  if (FOREHAND_FAMILY.has(type)) {
    if (dir === "3") return "FH_InsideOut";
    if (dir === "2") return "FH_Cross";
    if (dir === "1") return courtSide === "Ad" ? "FH_InsideOut" : "FH_Cross";
    return "Other";
  }
  if (BACKHAND_FAMILY.has(type)) {
    if (dir === "3") return "BH_Cross";
    if (dir === "1") return "BH_Line";
    return "Other";
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// MCP shot-string parser
// ---------------------------------------------------------------------------

/**
 * Deterministic MCP shot-string parser (guideline section 3.3).
 *
 * The active string is `2nd` when non-empty (serveNumber 2) else `1st`. Noise characters
 * are stripped, the first terminal symbol (* # @) ends the string, the serve digit (4/5/6)
 * gives the serve direction and the remaining shot tokens are counted for rallyLength
 * (serve included, final error shot included). A string ending with an error letter but
 * no terminal symbol is an unforced error (this is how double faults are usually charted).
 *
 * Intentional refinements of guideline section 3.3 (Token 1 / Token 2), kept so that the
 * "Unreturned / Ace" lane of the court lattice and the Ace_SvcWin node stay consistent:
 * - A return that never came back into play (return error, e.g. "4b7n@", "6b3n#") is
 *   returnDepth "Unreturned" even when the error token carries a depth digit; the depth
 *   digit is only used when the return was in play (rally of 3+ shots or a return winner).
 * - "Ace_SvcWin" implies returnDepth "Unreturned": it is assigned only to serve-only strings
 *   and return errors when the server won. A return winner (e.g. "5f2*") is always "Other",
 *   whatever `ctx.serverWon` says, because the server cannot have won that rally.
 *
 * A failure returns `{ ok: false, reason }` where reason is one of: emptyString,
 * unknownServeDirection, noServeDirection, invalidToken, shotAfterError,
 * firstServeFaultWithoutSecond, noTerminalSymbol.
 *
 * @param {string} firstServeStr   raw `1st` column
 * @param {string} secondServeStr  raw `2nd` column ("" if none)
 * @param {string} scoreStr        raw `Pts` column, server score first
 * @param {{ serverWon?: boolean, isTiebreak?: boolean }} [ctx]
 * @returns {{ ok: boolean, reason?: string, serveNumber?: 1|2, serveDirection?: string, returnDepth?: string, returnDepthImputed?: boolean,
 *   thirdShotArchetype?: string, rallyLength?: number, rallyBucket?: string, terminalOutcome?: string,
 *   pressureState?: string, courtSide?: string, isDoubleFault?: boolean, parsedServerWon?: boolean }}
 */
export function parseMcpRallyString(firstServeStr, secondServeStr, scoreStr, ctx = {}) {
  const first = sanitizeMcpString(firstServeStr);
  const second = sanitizeMcpString(secondServeStr);
  const serveNumber = second.length > 0 ? 2 : 1;
  const active = serveNumber === 2 ? second : first;
  const isTiebreak = ctx.isTiebreak === true;
  const pressureState = classifyPressureState(scoreStr, isTiebreak);
  const courtSide = deriveCourtSide(scoreStr);

  const fail = (reason) => ({ ok: false, reason, serveNumber, pressureState, courtSide });

  if (active.length === 0) return fail("emptyString");

  // Terminal symbol: the first occurrence ends the point; anything after it is charter noise.
  const termIdx = active.search(TERMINAL_RE);
  const terminalSymbol = termIdx >= 0 ? active[termIdx] : null;
  const body = termIdx >= 0 ? active.slice(0, termIdx) : active;

  const serveDigit = body[0];
  if (serveDigit === "0") return fail("unknownServeDirection");
  const serveDirection = SERVE_DIR_BY_DIGIT[serveDigit];
  if (!serveDirection) return fail("noServeDirection");

  const tokens = tokenizeRally(body.slice(1));
  if (!tokens.ok) return fail(tokens.reason);
  const { shots, errorLetter } = tokens;

  const rallyLength = shots.length + 1; // serve counts as shot 1
  const isServeError = shots.length === 0 && errorLetter !== null;
  if (isServeError && serveNumber === 1) return fail("firstServeFaultWithoutSecond");
  const isDoubleFault = isServeError && serveNumber === 2;

  let terminalOutcome = terminalSymbol ? OUTCOME_BY_SYMBOL[terminalSymbol] : null;
  if (!terminalOutcome) {
    if (errorLetter !== null) terminalOutcome = "UnforcedError";
    else return fail("noTerminalSymbol");
  }

  const lastShotIsError = errorLetter !== null || terminalOutcome !== "Winner";
  // Shot index parity: 0 = serve (server), odd = returner, even = server. A serve-only string
  // without a serve error letter is an ace or a service winner (the returner's forced error).
  const lastByServer = (rallyLength - 1) % 2 === 0;
  let parsedServerWon;
  if (isServeError) parsedServerWon = false;
  else if (shots.length === 0) parsedServerWon = true;
  else parsedServerWon = lastShotIsError ? !lastByServer : lastByServer;
  const serverWon = typeof ctx.serverWon === "boolean" ? ctx.serverWon : parsedServerWon;

  let returnDepth;
  let returnDepthImputed = false;
  let thirdShotArchetype;
  if (isDoubleFault) {
    returnDepth = "Unreturned";
    thirdShotArchetype = "Other";
  } else if (shots.length === 0 || (shots.length === 1 && lastShotIsError)) {
    // Ace / service winner, or a return attempt that never came back into play.
    // Guideline 3.3: no Token 2 => "Ace_SvcWin" if the server won, "Other" otherwise.
    returnDepth = "Unreturned";
    thirdShotArchetype = serverWon ? "Ace_SvcWin" : "Other";
  } else {
    returnDepthImputed = !DEPTH_BY_DIGIT[shots[0].depth];
    returnDepth = DEPTH_BY_DIGIT[shots[0].depth] || "Deep";
    // A return winner (no Token 2, return in play) can only be a server loss => "Other".
    thirdShotArchetype = shots.length >= 2 ? classifyThirdShot(shots[1], courtSide) : "Other";
  }

  return {
    ok: true,
    serveNumber,
    serveDirection,
    returnDepth,
    returnDepthImputed,
    thirdShotArchetype,
    rallyLength,
    rallyBucket: rallyBucketOf(rallyLength),
    terminalOutcome,
    pressureState,
    courtSide,
    isDoubleFault,
    parsedServerWon,
  };
}

// ---------------------------------------------------------------------------
// Record validation
// ---------------------------------------------------------------------------

/**
 * Validate a CanonicalPointRecord (types, enums, rallyLength >= 1 integer,
 * rallyBucket consistent with rallyLength, serveNumber 1|2).
 * @param {unknown} rec
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRecord(rec) {
  const errors = [];
  if (rec === null || typeof rec !== "object") return { ok: false, errors: ["record is not an object"] };
  const r = /** @type {Record<string, unknown>} */ (rec);

  const nonEmptyString = (key) => {
    if (typeof r[key] !== "string" || r[key].length === 0) errors.push(`${key} must be a non-empty string`);
  };
  const oneOf = (key, list) => {
    if (!list.includes(r[key])) errors.push(`${key} must be one of ${list.join("|")}`);
  };

  nonEmptyString("pointId");
  nonEmptyString("matchId");
  nonEmptyString("serverName");
  nonEmptyString("returnerName");
  oneOf("surface", SURFACES);
  if (r.serveNumber !== 1 && r.serveNumber !== 2) errors.push("serveNumber must be 1 or 2");
  oneOf("courtSide", ["Deuce", "Ad"]);
  oneOf("pressureState", PRESSURE_STATES);
  oneOf("serveDirection", SERVE_DIRS);
  oneOf("returnDepth", RETURN_DEPTHS);
  oneOf("thirdShotArchetype", THIRD_SHOTS);
  if (!Number.isInteger(r.rallyLength) || r.rallyLength < 1) {
    errors.push("rallyLength must be an integer >= 1");
  } else if (r.rallyBucket !== rallyBucketOf(r.rallyLength)) {
    errors.push(`rallyBucket must be ${rallyBucketOf(r.rallyLength)} for rallyLength ${r.rallyLength}`);
  }
  oneOf("rallyBucket", RALLY_BUCKETS);
  if (typeof r.serverWon !== "boolean") errors.push("serverWon must be a boolean");
  oneOf("terminalOutcome", TERMINAL_OUTCOMES);

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Shared adapter helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a raw surface label to the canonical vocabulary.
 * @param {unknown} value
 * @param {Record<string, string>} [aliases]  extra lower-cased aliases (e.g. { carpet: "Hard" })
 * @returns {"Hard"|"Clay"|"Grass"|null}
 */
function normalizeSurface(value, aliases) {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "hard") return "Hard";
  if (key === "clay") return "Clay";
  if (key === "grass") return "Grass";
  if (aliases && Object.prototype.hasOwnProperty.call(aliases, key) && SURFACES.includes(aliases[key])) {
    return aliases[key];
  }
  return null;
}

/** @returns {{ total: number, kept: number, skipped: number, reasons: Record<string, number> }} */
function newStats() {
  return { total: 0, kept: 0, skipped: 0, reasons: {} };
}

/**
 * Count one skipped row under a reason.
 * @param {{ skipped: number, reasons: Record<string, number> }} stats
 * @param {string} reason
 */
function skip(stats, reason) {
  stats.skipped += 1;
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
}

// ---------------------------------------------------------------------------
// MCP rows adapter
// ---------------------------------------------------------------------------

/**
 * Adapt raw MCP CSV rows (objects keyed by the charting-m-points / charting-m-matches
 * headers) into an immutable (frozen) array of frozen CanonicalPointRecord objects.
 * Unparseable rows are skipped and counted. A row whose pointId (match_id + Pt) was already
 * emitted is skipped under `duplicatePointId` so pointId stays a unique key (the raw MCP
 * files contain a few re-charted matches). Tiebreaks are detected per game (any row of the
 * game with a plain tiebreak score, or 6-6 in a tiebreak set).
 *
 * Options:
 * - allowedPlayers: keep a point if the server OR the returner is in the set (both when requireBoth).
 * - maxPoints: stop after that many kept points (stats.truncated = true).
 * - surfaceAliases: extra lower-cased surface aliases, e.g. { carpet: "Hard" } (otherwise skipped).
 * - includeRaw: attach the active raw shot string as `rawString`.
 * - excludeImputedReturnDepth: skip in-play returns with no recorded depth instead of using Deep.
 *
 * @param {Object[]} pointRows
 * @param {Object[]} matchRows
 * @param {{ allowedPlayers?: Set<string>|null, requireBoth?: boolean, maxPoints?: number,
 *           surfaceAliases?: Record<string, string>, includeRaw?: boolean, excludeImputedReturnDepth?: boolean }} [options]
 * @returns {{ points: CanonicalPointRecord[], stats: { total: number, kept: number, skipped: number,
 *   reasons: Record<string, number>, winnerMismatch: number, returnDepthImputed: number, truncated: boolean } }}
 */
export function adaptMcpRows(pointRows, matchRows, options = {}) {
  const {
    allowedPlayers = null,
    requireBoth = false,
    maxPoints = Infinity,
    surfaceAliases = undefined,
    includeRaw = false,
    excludeImputedReturnDepth = false,
  } = options;

  const matches = new Map();
  for (const m of matchRows || []) {
    const id = String(m.match_id ?? "").trim();
    if (!id) continue;
    matches.set(id, {
      p1: String(m["Player 1"] ?? "").trim(),
      p2: String(m["Player 2"] ?? "").trim(),
      h1: String(m["Pl 1 hand"] ?? "").trim(),
      h2: String(m["Pl 2 hand"] ?? "").trim(),
      date: String(m.Date ?? "").trim(),
      tournament: String(m.Tournament ?? "").trim(),
      round: String(m.Round ?? "").trim(),
      surface: normalizeSurface(m.Surface, surfaceAliases),
    });
  }

  const stats = { ...newStats(), winnerMismatch: 0, returnDepthImputed: 0, truncated: false };
  const points = [];
  const rows = Array.isArray(pointRows) ? pointRows : [];
  const tiebreakGames = collectTiebreakGames(rows);
  const seenIds = new Set();

  for (const row of rows) {
    if (points.length >= maxPoints) {
      stats.truncated = true;
      break;
    }
    stats.total += 1;
    if (!row || typeof row !== "object") { skip(stats, "invalidRow"); continue; }

    const matchId = String(row.match_id ?? "").trim();
    const match = matches.get(matchId);
    if (!match) { skip(stats, "missingMatch"); continue; }
    const pointId = `${matchId}-${String(row.Pt ?? "").trim()}`;
    if (seenIds.has(pointId)) { skip(stats, "duplicatePointId"); continue; }
    if (!match.surface) { skip(stats, "unsupportedSurface"); continue; }
    if (!match.p1 || !match.p2) { skip(stats, "missingPlayerName"); continue; }

    const svr = String(row.Svr ?? "").trim();
    if (svr !== "1" && svr !== "2") { skip(stats, "invalidServer"); continue; }
    const winner = String(row.PtWinner ?? "").trim();
    if (winner !== "1" && winner !== "2") { skip(stats, "invalidWinner"); continue; }

    const serverName = svr === "1" ? match.p1 : match.p2;
    const returnerName = svr === "1" ? match.p2 : match.p1;
    if (allowedPlayers) {
      const sIn = allowedPlayers.has(serverName);
      const rIn = allowedPlayers.has(returnerName);
      const pass = requireBoth ? sIn && rIn : sIn || rIn;
      if (!pass) { skip(stats, "playerFiltered"); continue; }
    }

    const serverWon = winner === svr;
    const gameKey = gameKeyOf(row);
    const isTiebreak = isTiebreakRow(row) || (gameKey !== null && tiebreakGames.has(gameKey));
    const parsed = parseMcpRallyString(row["1st"], row["2nd"], String(row.Pts ?? ""), { serverWon, isTiebreak });
    if (!parsed.ok) { skip(stats, parsed.reason); continue; }
    if (parsed.returnDepthImputed) {
      stats.returnDepthImputed += 1;
      if (excludeImputedReturnDepth) { skip(stats, "unrecordedReturnDepth"); continue; }
    }
    if (parsed.parsedServerWon !== serverWon) stats.winnerMismatch += 1;

    const rec = {
      pointId,
      matchId,
      surface: match.surface,
      serverName,
      returnerName,
      serveNumber: parsed.serveNumber,
      courtSide: parsed.courtSide,
      pressureState: parsed.pressureState,
      serveDirection: parsed.serveDirection,
      returnDepth: parsed.returnDepth,
      thirdShotArchetype: parsed.thirdShotArchetype,
      rallyLength: parsed.rallyLength,
      rallyBucket: parsed.rallyBucket,
      serverWon,
      terminalOutcome: parsed.terminalOutcome,
      date: match.date,
      tournament: match.tournament,
      eventTier: classifyEventTier(match.tournament, match.date),
      round: match.round,
      serverHand: svr === "1" ? match.h1 : match.h2,
      returnerHand: svr === "1" ? match.h2 : match.h1,
    };
    if (includeRaw) {
      rec.rawString = parsed.serveNumber === 2 ? String(row["2nd"] ?? "") : String(row["1st"] ?? "");
    }

    if (!validateRecord(rec).ok) { skip(stats, "invalidRecord"); continue; }
    seenIds.add(pointId);
    points.push(Object.freeze(rec));
    stats.kept += 1;
  }

  return { points: Object.freeze(points), stats };
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

/**
 * Minimal RFC4180-ish CSV parser: quoted fields (with "" escapes and embedded
 * commas / newlines), CRLF or LF line endings, optional BOM and trailing newline.
 * Rows shorter than the header are padded with "", longer rows are truncated.
 * @param {string} text
 * @returns {Object[]}  array of objects keyed by header
 */
export function parseCsv(text) {
  if (typeof text !== "string") return [];
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const rows = [];
  let fields = [];
  let field = "";
  let inQuotes = false;
  const len = src.length;

  for (let i = 0; i < len; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      fields.push(field);
      field = "";
      rows.push(fields);
      fields = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || fields.length > 0) {
    fields.push(field);
    rows.push(fields);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0] === "") continue; // blank line
    const obj = {};
    for (let c = 0; c < header.length; c += 1) obj[header[c]] = cells[c] === undefined ? "" : cells[c];
    out.push(obj);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generic adapter
// ---------------------------------------------------------------------------

const CANONICAL_FIELDS = [
  "pointId", "matchId", "surface", "serverName", "returnerName", "serveNumber", "courtSide",
  "pressureState", "serveDirection", "returnDepth", "thirdShotArchetype", "rallyLength",
  "rallyBucket", "serverWon", "terminalOutcome",
];
const OPTIONAL_FIELDS = ["date", "tournament", "round", "serverHand", "returnerHand", "rawString"];

/** Lenient boolean coercion ("true"/"1"/"yes" ...); unknown values are returned unchanged. */
function toBoolean(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "n"].includes(s)) return false;
  }
  return v;
}

/** Lenient integer coercion from numeric strings; unknown values are returned unchanged. */
function toInteger(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return v;
}

/**
 * Dataset-agnostic adapter: map arbitrary row objects into a frozen array of frozen
 * CanonicalPointRecord objects using a fieldMap ({ canonicalField: sourceFieldName | (row) => value }). Light coercions are
 * applied (serveNumber / rallyLength to integers, serverWon to boolean, surface normalized)
 * and rallyBucket is derived from rallyLength when not mapped. Each record is validated;
 * invalid ones are skipped and counted under their first validation error.
 *
 * @param {Object[]} rows
 * @param {Record<string, string|((row: Object) => unknown)>} fieldMap
 * @returns {{ points: CanonicalPointRecord[], stats: { total: number, kept: number, skipped: number,
 *   reasons: Record<string, number> } }}
 */
export function adaptGenericRows(rows, fieldMap) {
  const stats = newStats();
  const points = [];
  const map = fieldMap || {};
  const read = (row, key) => {
    const src = map[key];
    if (src === undefined) return undefined;
    return typeof src === "function" ? src(row) : row[src];
  };

  for (const row of rows || []) {
    stats.total += 1;
    const rec = {};
    for (const key of CANONICAL_FIELDS) {
      const v = read(row, key);
      if (v !== undefined) rec[key] = v;
    }
    for (const key of OPTIONAL_FIELDS) {
      const v = read(row, key);
      if (v !== undefined && v !== null) rec[key] = String(v);
    }

    if (rec.serveNumber !== undefined) rec.serveNumber = toInteger(rec.serveNumber);
    if (rec.rallyLength !== undefined) rec.rallyLength = toInteger(rec.rallyLength);
    if (rec.serverWon !== undefined) rec.serverWon = toBoolean(rec.serverWon);
    if (rec.surface !== undefined) rec.surface = normalizeSurface(rec.surface) ?? rec.surface;
    if (rec.rallyBucket === undefined && Number.isInteger(rec.rallyLength)) {
      rec.rallyBucket = rallyBucketOf(rec.rallyLength);
    }
    for (const key of ["pointId", "matchId", "serverName", "returnerName"]) {
      if (typeof rec[key] === "number") rec[key] = String(rec[key]);
    }

    const check = validateRecord(rec);
    if (!check.ok) { skip(stats, check.errors[0]); continue; }
    points.push(Object.freeze(rec));
    stats.kept += 1;
  }
  return { points: Object.freeze(points), stats };
}

// ---------------------------------------------------------------------------
// Synthetic fallback dataset
// ---------------------------------------------------------------------------

/**
 * mulberry32 PRNG: deterministic 32-bit generator returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted choice. Weights need not sum to 1.
 * @template T
 * @param {() => number} rng
 * @param {T[]} items
 * @param {number[]} weights
 * @returns {T}
 */
function pickWeighted(rng, items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let u = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    u -= weights[i];
    if (u < 0) return items[i];
  }
  return items[items.length - 1];
}

const clampProb = (x) => Math.min(0.98, Math.max(0.02, x));

/** Synthetic player pool: serve = 1st-serve point-win baseline, firstIn = 1st-serve-in rate, ret = return quality. */
const FALLBACK_PLAYERS = [
  { name: "Jannik Sinner", hand: "R", serve: 0.69, firstIn: 0.63, ret: 0.43 },
  { name: "Carlos Alcaraz", hand: "R", serve: 0.675, firstIn: 0.65, ret: 0.43 },
  { name: "Novak Djokovic", hand: "R", serve: 0.68, firstIn: 0.64, ret: 0.44 },
  { name: "Daniil Medvedev", hand: "R", serve: 0.67, firstIn: 0.60, ret: 0.42 },
  { name: "Alexander Zverev", hand: "R", serve: 0.685, firstIn: 0.62, ret: 0.40 },
  { name: "Taylor Fritz", hand: "R", serve: 0.695, firstIn: 0.61, ret: 0.38 },
  { name: "Holger Rune", hand: "R", serve: 0.655, firstIn: 0.60, ret: 0.39 },
  { name: "Casper Ruud", hand: "R", serve: 0.66, firstIn: 0.62, ret: 0.39 },
];

const FALLBACK_TOURNAMENTS = {
  Hard: [["Australian Open", "01"], ["Indian Wells Masters", "03"], ["Miami Masters", "03"], ["US Open", "09"], ["Shanghai Masters", "10"], ["Paris Masters", "11"]],
  Clay: [["Monte Carlo Masters", "04"], ["Madrid Masters", "05"], ["Rome Masters", "05"], ["Roland Garros", "06"]],
  Grass: [["Halle", "06"], ["Queens Club", "06"], ["Wimbledon", "07"]],
};
const FALLBACK_ROUNDS = ["R32", "R16", "QF", "SF", "F"];
const GAME_LABELS = ["0", "15", "30", "40"];

/**
 * Build the k-th synthetic match descriptor.
 * @param {() => number} rng
 * @param {number} k
 * @returns {{ matchId: string, surface: string, tournament: string, round: string, date: string, players: Object[] }}
 */
function makeFallbackMatch(rng, k) {
  const i = Math.floor(rng() * FALLBACK_PLAYERS.length);
  let j = Math.floor(rng() * (FALLBACK_PLAYERS.length - 1));
  if (j >= i) j += 1;
  const surface = pickWeighted(rng, SURFACES, [0.5, 0.3, 0.2]);
  const pool = FALLBACK_TOURNAMENTS[surface];
  const [tournament, month] = pool[Math.floor(rng() * pool.length)];
  const round = FALLBACK_ROUNDS[Math.floor(rng() * FALLBACK_ROUNDS.length)];
  const year = 2024 + (k % 2);
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, "0");
  const date = `${year}${month}${day}`;
  const slug = (s) => s.replace(/\s+/g, "_");
  const players = [FALLBACK_PLAYERS[i], FALLBACK_PLAYERS[j]];
  const matchId = `${date}-M-${slug(tournament)}-${round}-${slug(players[0].name)}-${slug(players[1].name)}`;
  return { matchId, surface, tournament, round, date, players };
}

/**
 * Server-first score label for a regular game.
 * @param {number} ps  server points
 * @param {number} pr  returner points
 * @returns {string}
 */
function gameScoreLabel(ps, pr) {
  if (ps >= 3 && pr >= 3) {
    if (ps === pr) return "40-40";
    return ps > pr ? "AD-40" : "40-AD";
  }
  return `${GAME_LABELS[Math.min(ps, 3)]}-${GAME_LABELS[Math.min(pr, 3)]}`;
}

/**
 * Simulate the tactical outcome of one synthetic point given its context.
 * @param {() => number} rng
 * @param {{ server: Object, returner: Object, surface: string, courtSide: string, pressureState: string }} c
 * @returns {{ serveNumber: 1|2, serveDirection: string, returnDepth: string, thirdShotArchetype: string,
 *   rallyLength: number, serverWon: boolean, terminalOutcome: string }}
 */
function simulateFallbackPoint(rng, c) {
  const { server, returner, surface, courtSide, pressureState } = c;
  const edge = (server.serve - 0.675) - (returner.ret - 0.41) * 0.6; // player-strength offset
  const onBreak = pressureState === "BreakPoint";
  const firstIn = rng() < server.firstIn + (surface === "Clay" ? 0.02 : 0);
  const serveNumber = firstIn ? 1 : 2;

  // Double fault.
  if (serveNumber === 2 && rng() < 0.045 + (onBreak ? 0.01 : 0)) {
    return {
      serveNumber, serveDirection: pickWeighted(rng, SERVE_DIRS, [0.3, 0.4, 0.3]), returnDepth: "Unreturned",
      thirdShotArchetype: "Other", rallyLength: 1, serverWon: false, terminalOutcome: "UnforcedError",
    };
  }

  // Serve direction: side- and pressure-dependent (wide shift on break points).
  let dirW;
  if (serveNumber === 1) dirW = courtSide === "Deuce" ? [0.40, 0.14, 0.46] : [0.46, 0.14, 0.40];
  else dirW = courtSide === "Deuce" ? [0.30, 0.36, 0.34] : [0.34, 0.36, 0.30];
  if (onBreak) dirW = [dirW[0] + 0.12, dirW[1] - 0.02, dirW[2] - 0.10];
  const serveDirection = pickWeighted(rng, SERVE_DIRS, dirW);

  // Unreturned probability conditional on serve direction, serve number and surface.
  const baseUnret = { Wide: 0.33, Body: 0.21, T: 0.36 }[serveDirection];
  let pUnret = serveNumber === 1 ? baseUnret : baseUnret * 0.32;
  pUnret += surface === "Grass" ? 0.06 : surface === "Clay" ? -0.05 : 0;
  pUnret += edge * 0.5;
  if (rng() < clampProb(pUnret)) {
    const aceShare = serveNumber === 1 && serveDirection !== "Body" ? 0.5 : 0.22;
    const isAce = rng() < aceShare + (surface === "Grass" ? 0.08 : 0);
    return {
      serveNumber, serveDirection, returnDepth: "Unreturned", thirdShotArchetype: "Ace_SvcWin",
      rallyLength: isAce ? 1 : 2, serverWon: true,
      terminalOutcome: isAce ? "Winner" : rng() < 0.75 ? "ForcedError" : "UnforcedError",
    };
  }

  // Return depth conditional on serve.
  let depthW = serveNumber === 1 ? [0.36, 0.44, 0.20] : [0.20, 0.44, 0.36];
  if (serveDirection === "Body") depthW = [depthW[0] - 0.06, depthW[1] + 0.08, depthW[2] - 0.02];
  if (surface === "Clay") depthW = [depthW[0] - 0.05, depthW[1], depthW[2] + 0.05];
  if (surface === "Grass") depthW = [depthW[0] + 0.05, depthW[1], depthW[2] - 0.05];
  const returnDepth = pickWeighted(rng, ["Shallow", "Deep", "VeryDeep"], depthW);

  // Return winner (point ends at shot 2).
  const pReturnWinner = { Shallow: 0.012, Deep: 0.025, VeryDeep: 0.05 }[returnDepth] + (serveNumber === 2 ? 0.015 : 0);
  if (rng() < pReturnWinner) {
    return {
      serveNumber, serveDirection, returnDepth, thirdShotArchetype: "Other", rallyLength: 2,
      serverWon: false, terminalOutcome: "Winner",
    };
  }

  // Third shot conditional on return depth.
  const thirdW = {
    Shallow: [0.36, 0.22, 0.12, 0.06, 0.12, 0.12],
    Deep: [0.30, 0.26, 0.18, 0.08, 0.04, 0.14],
    VeryDeep: [0.22, 0.26, 0.24, 0.10, 0.02, 0.16],
  }[returnDepth];
  const thirdShotArchetype = pickWeighted(
    rng, ["FH_InsideOut", "FH_Cross", "BH_Cross", "BH_Line", "Net_Drop", "Other"], thirdW,
  );

  // Rally length: geometric-ish continuation with surface and return-depth effects.
  let pCont = surface === "Clay" ? 0.78 : surface === "Grass" ? 0.66 : 0.72;
  pCont += { Shallow: -0.08, Deep: 0, VeryDeep: 0.05 }[returnDepth];
  if (thirdShotArchetype === "Net_Drop") pCont -= 0.2;
  let rallyLength = 3;
  while (rallyLength < 30 && rng() < pCont) {
    rallyLength += 1;
    pCont -= 0.01;
  }

  // The final shot is hit by the server at odd lengths and by the returner at even lengths;
  // the point ends with that player's winner or error. As in MCP telemetry the server can
  // only win an odd-length rally with a winner, which yields the real odd/even sawtooth
  // (~0.31 / ~0.70 at 9+) while the bucket aggregates land near the MCP values:
  // ~0.73 (1-4, aces included), ~0.52 (5-8), ~0.48 (9+).
  const lastByServer = (rallyLength - 1) % 2 === 0;
  let pWin;
  if (lastByServer) pWin = rallyLength === 3 ? 0.56 : rallyLength === 5 ? 0.41 : rallyLength === 7 ? 0.36 : 0.33;
  else pWin = rallyLength === 4 ? 0.76 : rallyLength === 6 ? 0.72 : rallyLength === 8 ? 0.71 : 0.71;
  // Return depth, second serve and player strength matter early and vanish by ~9 shots.
  const fade = Math.max(0, 1 - (rallyLength - 3) / 6);
  pWin += ({ Shallow: 0.08, Deep: 0, VeryDeep: -0.08 }[returnDepth] + (serveNumber === 2 ? -0.04 : 0)) * fade;
  pWin += edge * 0.6 * Math.max(fade, 0.3);
  const serverWon = rng() < clampProb(pWin);

  // Terminal outcome: a winner when the last hitter won, else that player's error
  // (unforced errors dominate long rallies).
  let terminalOutcome;
  if (serverWon === lastByServer) terminalOutcome = "Winner";
  else {
    const pUnforced = rallyLength <= 4 ? 0.5 : rallyLength <= 8 ? 0.58 : 0.66;
    terminalOutcome = rng() < pUnforced ? "UnforcedError" : "ForcedError";
  }

  return { serveNumber, serveDirection, returnDepth, thirdShotArchetype, rallyLength, serverWon, terminalOutcome };
}

/**
 * Deterministic (seeded) synthetic dataset of realistic points modeled on ATP matches
 * between top players on hard, clay and grass (guideline section 8 Phase 1.2).
 * Points are produced by simulating real scoring (games, deuce/advantage, tiebreaks at 6-6,
 * best of three sets) so pressure states and court sides follow true tennis frequencies.
 * The same (n, seed) always yields the same records.
 * @param {number} [n=6000]
 * @param {number} [seed=42]
 * @returns {CanonicalPointRecord[]}
 */
export function generateFallbackMcpDataset(n = 6000, seed = 42) {
  const rng = mulberry32(seed);
  const points = [];
  let matchIndex = 0;

  while (points.length < n) {
    const match = makeFallbackMatch(rng, matchIndex);
    matchIndex += 1;
    const sets = [0, 0];
    const games = [0, 0];
    const pts = [0, 0];
    let gameServer = matchIndex % 2 === 0 ? 0 : 1;
    let tbStarter = gameServer;
    let tbPoints = 0;
    let inTiebreak = false;
    let pt = 0;

    while (sets[0] < 2 && sets[1] < 2 && points.length < n) {
      let server;
      if (inTiebreak) {
        // First point by the starter, then alternating every two points.
        server = tbPoints === 0 ? tbStarter : (Math.floor((tbPoints - 1) / 2) % 2 === 0 ? 1 - tbStarter : tbStarter);
      } else {
        server = gameServer;
      }
      const returner = 1 - server;
      const scoreStr = inTiebreak ? `${pts[server]}-${pts[returner]}` : gameScoreLabel(pts[server], pts[returner]);
      const courtSide = deriveCourtSide(scoreStr);
      const pressureState = classifyPressureState(scoreStr, inTiebreak);

      const sim = simulateFallbackPoint(rng, {
        server: match.players[server],
        returner: match.players[returner],
        surface: match.surface,
        courtSide,
        pressureState,
      });
      pt += 1;
      points.push(Object.freeze({
        pointId: `${match.matchId}-${pt}`,
        matchId: match.matchId,
        surface: match.surface,
        serverName: match.players[server].name,
        returnerName: match.players[returner].name,
        serveNumber: sim.serveNumber,
        courtSide,
        pressureState,
        serveDirection: sim.serveDirection,
        returnDepth: sim.returnDepth,
        thirdShotArchetype: sim.thirdShotArchetype,
        rallyLength: sim.rallyLength,
        rallyBucket: rallyBucketOf(sim.rallyLength),
        serverWon: sim.serverWon,
        terminalOutcome: sim.terminalOutcome,
        date: match.date,
        tournament: match.tournament,
        round: match.round,
        serverHand: match.players[server].hand,
        returnerHand: match.players[returner].hand,
      }));

      // Advance the score.
      const w = sim.serverWon ? server : returner;
      const l = 1 - w;
      pts[w] += 1;
      if (inTiebreak) {
        tbPoints += 1;
        if (pts[w] >= 7 && pts[w] - pts[l] >= 2) {
          sets[w] += 1;
          games[0] = 0; games[1] = 0; pts[0] = 0; pts[1] = 0;
          inTiebreak = false;
          gameServer = 1 - tbStarter;
        }
      } else if (pts[w] >= 4 && pts[w] - pts[l] >= 2) {
        games[w] += 1;
        pts[0] = 0; pts[1] = 0;
        gameServer = 1 - gameServer;
        if (games[w] >= 6 && games[w] - games[l] >= 2) {
          sets[w] += 1;
          games[0] = 0; games[1] = 0;
        } else if (games[0] === 6 && games[1] === 6) {
          inTiebreak = true;
          tbPoints = 0;
          tbStarter = gameServer;
        }
      }
    }
  }
  return Object.freeze(points);
}

// ---------------------------------------------------------------------------
// Dataset loader
// ---------------------------------------------------------------------------

/**
 * Expand the dictionary-encoded recent MCP extract into canonical point records.
 * @param {object} json
 * @returns {object[]}
 */
export function decodeDictionaryDataset(json) {
  const { fields, dictionaries, rows } = json;
  if (!Array.isArray(fields) || !fields.includes("matchId") || !dictionaries || !Array.isArray(rows)
      || fields.some((field) => typeof field !== "string" || !Array.isArray(dictionaries[field]))) {
    throw new TypeError("invalid dictionary dataset");
  }
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length !== fields.length + 1 || typeof row[0] !== "string") {
      throw new TypeError("invalid dictionary dataset row");
    }
    const point = {};
    for (let i = 0; i < fields.length; i += 1) {
      const dict = dictionaries[fields[i]];
      const index = row[i + 1];
      if (!Number.isInteger(index) || index < 0 || index >= dict.length) throw new TypeError("invalid dictionary index");
      point[fields[i]] = dict[index];
    }
    point.pointId = `${point.matchId}-${row[0]}`;
    return point;
  });
}

/**
 * matchId -> { tournament, date } from a dataset's meta.matchList (array or object), or null.
 * @param {object|null} meta
 * @returns {Map<string, { tournament: string, date: string }>|null}
 */
function matchInfoOf(meta) {
  const list = meta && meta.matchList;
  if (!list || typeof list !== "object") return null;
  const map = new Map();
  for (const m of Array.isArray(list) ? list : Object.values(list)) {
    if (m && typeof m.matchId === "string") map.set(m.matchId, { tournament: m.tournament, date: m.date });
  }
  return map;
}

/**
 * Copy of a record carrying `tournament` and `eventTier` (from the record itself, else from the
 * match list; the date falls back to the YYYYMMDD prefix of the MCP match id).
 * @param {object} rec
 * @param {Map<string, { tournament: string, date: string }>|null} matchInfo
 * @returns {object}
 */
function withEventTier(rec, matchInfo) {
  if (typeof rec.eventTier === "string") return Object.isFrozen(rec) ? rec : { ...rec };
  const info = matchInfo && matchInfo.get(rec.matchId);
  const tournament = rec.tournament || (info && info.tournament) || "";
  const date = rec.date || (info && info.date) || String(rec.matchId || "").slice(0, 8);
  return { ...rec, tournament, eventTier: classifyEventTier(tournament, date) };
}

/**
 * Load a dataset JSON ({ meta, points } or a bare array of records). On any failure
 * (no fetch, network error, file://, invalid shape, no valid records) resolves with the
 * synthetic fallback dataset. Never rejects. Invalid records in a remote dataset are dropped
 * and counted in meta.dropped.
 * @param {{ dataUrl?: string, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ points: CanonicalPointRecord[], source: "remote"|"fallback", meta: object }>}
 */
export async function loadDataset({ dataUrl, fetchImpl = globalThis.fetch } = {}) {
  const fallback = (reason) => {
    const points = generateFallbackMcpDataset();
    const matches = new Set(points.map((p) => p.matchId));
    const players = [...new Set(points.map((p) => p.serverName))].sort();
    return {
      points,
      source: "fallback",
      meta: {
        source: "Synthetic fallback (seeded, modeled on MCP telemetry)",
        generatedAt: null,
        matches: matches.size,
        players,
        note: `Fallback dataset used: ${reason}`,
      },
    };
  };

  if (!dataUrl || typeof fetchImpl !== "function") return fallback("no dataUrl or fetch implementation");
  try {
    const res = await fetchImpl(dataUrl);
    if (!res || (typeof res.ok === "boolean" && !res.ok)) throw new Error(`HTTP ${res && res.status}`);
    const json = await res.json();
    const raw = Array.isArray(json) ? json : json && Array.isArray(json.points) ? json.points
      : json && json.encoding === "dictionary-v1" ? decodeDictionaryDataset(json) : null;
    if (!raw) throw new Error("dataset has no points array");
    const matchInfo = matchInfoOf(json && !Array.isArray(json) ? json.meta : null);
    const points = [];
    for (const rec of raw) {
      if (!validateRecord(rec).ok) continue;
      points.push(Object.freeze(withEventTier(rec, matchInfo)));
    }
    if (points.length === 0) throw new Error("dataset has no valid records");
    const meta = json && !Array.isArray(json) && json.meta && typeof json.meta === "object" ? json.meta : {};
    return {
      points: Object.freeze(points),
      source: "remote",
      meta: { ...meta, loaded: points.length, dropped: raw.length - points.length },
    };
  } catch (err) {
    return fallback(err && err.message ? err.message : String(err));
  }
}
