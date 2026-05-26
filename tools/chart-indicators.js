import { config } from "../config.js";
import { log } from "../logger.js";
import {
  agentMeridianJson,
  getAgentMeridianHeaders,
} from "./agent-meridian.js";
import { safeNumber } from "../utils/number.js";

const DEFAULT_INTERVALS = ["5_MINUTE"];
const DEFAULT_CANDLES = 298;

function normalizeIntervals(intervals) {
  const list = Array.isArray(intervals) ? intervals : DEFAULT_INTERVALS;
  return list
    .map((value) =>
      String(value || "")
        .trim()
        .toUpperCase(),
    )
    .filter((value) => value === "5_MINUTE" || value === "15_MINUTE");
}

function safeNum(value) {
  return safeNumber(value, null);
}

/**
 * Compute RSI locally from raw candle close prices using Wilder's smoothing.
 * @param {Array} candles - Array of { close } objects from backend
 * @param {number} period - RSI period (default 14)
 * @returns {number|null} RSI value 0-100, or null if insufficient data
 */
function computeLocalRSI(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  const closes = candles.map((c) => Number(c?.close)).filter(Number.isFinite);
  if (closes.length < period + 1) return null;

  // Calculate price changes
  const deltas = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i] - closes[i - 1]);
  }

  // First average: simple average of first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (deltas[i] > 0) avgGain += deltas[i];
    else avgLoss += Math.abs(deltas[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining deltas
  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? Math.abs(deltas[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(4));
}

function buildSignalSummary(payload) {
  const latest = payload?.latest || {};
  const candle = latest?.candle || {};
  const previousCandle = latest?.previousCandle || {};
  const rsi = safeNum(latest?.rsi?.value);
  const bollinger = latest?.bollinger || {};
  const supertrend = latest?.supertrend || {};
  const fibonacciLevels = latest?.fibonacci?.levels || {};
  return {
    close: safeNum(candle.close),
    previousClose: safeNum(previousCandle.close),
    rsi,
    lowerBand: safeNum(bollinger.lower),
    middleBand: safeNum(bollinger.middle),
    upperBand: safeNum(bollinger.upper),
    supertrendValue: safeNum(supertrend.value),
    supertrendDirection: String(supertrend.direction || "unknown"),
    supertrendBreakUp: !!latest?.states?.supertrendBreakUp,
    supertrendBreakDown: !!latest?.states?.supertrendBreakDown,
    fib50: safeNum(fibonacciLevels["0.500"]),
    fib618: safeNum(fibonacciLevels["0.618"]),
    fib786: safeNum(fibonacciLevels["0.786"]),
  };
}

export function evaluatePreset(side, preset, payload) {
  const summary = buildSignalSummary(payload);
  const oversold = Number(config.indicators.rsiOversold ?? 30);
  const overbought = Number(config.indicators.rsiOverbought ?? 80);
  const close = summary.close;
  const previousClose = summary.previousClose;
  const lowerBand = summary.lowerBand;
  const upperBand = summary.upperBand;
  const rsi = summary.rsi;
  const isBullish = summary.supertrendDirection === "bullish";
  const isBearish = summary.supertrendDirection === "bearish";
  const crossedUp = (level) =>
    level != null &&
    close != null &&
    previousClose != null &&
    previousClose < level &&
    close >= level;
  const crossedDown = (level) =>
    level != null &&
    close != null &&
    previousClose != null &&
    previousClose > level &&
    close <= level;

  switch (preset) {
    case "supertrend_break":
      return side === "entry"
        ? {
            confirmed:
              summary.supertrendBreakUp ||
              (isBullish &&
                close != null &&
                summary.supertrendValue != null &&
                close >= summary.supertrendValue),
            reason: summary.supertrendBreakUp
              ? "Supertrend flipped bullish"
              : "Price is above bullish Supertrend",
            signal: summary,
          }
        : {
            confirmed:
              summary.supertrendBreakDown ||
              (isBearish &&
                close != null &&
                summary.supertrendValue != null &&
                close <= summary.supertrendValue),
            reason: summary.supertrendBreakDown
              ? "Supertrend flipped bearish"
              : "Price is below bearish Supertrend",
            signal: summary,
          };
    case "rsi_reversal":
      return side === "entry"
        ? {
            confirmed: rsi != null && rsi <= oversold,
            reason: `RSI ${rsi ?? "n/a"} <= oversold ${oversold}`,
            signal: summary,
          }
        : {
            confirmed: rsi != null && rsi >= overbought,
            reason: `RSI ${rsi ?? "n/a"} >= overbought ${overbought}`,
            signal: summary,
          };
    case "bollinger_reversion":
      return side === "entry"
        ? {
            confirmed: close != null && lowerBand != null && close <= lowerBand,
            reason: `Close ${close ?? "n/a"} <= lower band ${lowerBand ?? "n/a"}`,
            signal: summary,
          }
        : {
            confirmed: close != null && upperBand != null && close >= upperBand,
            reason: `Close ${close ?? "n/a"} >= upper band ${upperBand ?? "n/a"}`,
            signal: summary,
          };
    case "rsi_plus_supertrend":
      return side === "entry"
        ? {
            confirmed:
              rsi != null &&
              rsi <= oversold &&
              (summary.supertrendBreakUp || isBullish),
            reason: `RSI oversold with bullish Supertrend context`,
            signal: summary,
          }
        : {
            confirmed:
              rsi != null &&
              rsi >= overbought &&
              (summary.supertrendBreakDown || isBearish),
            reason: `RSI overbought with bearish Supertrend context`,
            signal: summary,
          };
    case "supertrend_or_rsi":
      return side === "entry"
        ? {
            confirmed:
              summary.supertrendBreakUp ||
              (isBullish &&
                close != null &&
                summary.supertrendValue != null &&
                close >= summary.supertrendValue) ||
              (rsi != null && rsi <= oversold),
            reason: "Supertrend bullish confirmation or RSI oversold",
            signal: summary,
          }
        : {
            confirmed:
              summary.supertrendBreakDown ||
              (isBearish &&
                close != null &&
                summary.supertrendValue != null &&
                close <= summary.supertrendValue) ||
              (rsi != null && rsi >= overbought),
            reason: "Supertrend bearish confirmation or RSI overbought",
            signal: summary,
          };
    case "bb_plus_rsi":
      return side === "entry"
        ? {
            confirmed:
              close != null &&
              lowerBand != null &&
              close <= lowerBand &&
              rsi != null &&
              rsi <= oversold,
            reason: "Close at/below lower band with RSI oversold",
            signal: summary,
          }
        : {
            confirmed:
              close != null &&
              upperBand != null &&
              close >= upperBand &&
              rsi != null &&
              rsi >= overbought,
            reason: "Close at/above upper band with RSI overbought",
            signal: summary,
          };
    case "fibo_reclaim":
      return side === "entry"
        ? {
            confirmed:
              crossedUp(summary.fib618) ||
              crossedUp(summary.fib50) ||
              crossedUp(summary.fib786),
            reason: "Price reclaimed a key Fibonacci level",
            signal: summary,
          }
        : {
            confirmed: crossedUp(summary.fib618) || crossedUp(summary.fib50),
            reason: "Price reclaimed a key Fibonacci level upward",
            signal: summary,
          };
    case "fibo_reject":
      return side === "entry"
        ? {
            confirmed:
              crossedDown(summary.fib618) || crossedDown(summary.fib50),
            reason: "Price rejected from a key Fibonacci level",
            signal: summary,
          }
        : {
            confirmed:
              crossedDown(summary.fib618) ||
              crossedDown(summary.fib50) ||
              crossedDown(summary.fib786),
            reason: "Price rejected below a key Fibonacci level",
            signal: summary,
          };
    default:
      return {
        confirmed: false,
        reason: `Unknown preset ${preset}`,
        signal: summary,
      };
  }
}

export async function fetchChartIndicatorsForMint(
  mint,
  {
    interval,
    candles = config.indicators.candles ?? DEFAULT_CANDLES,
    rsiLength = config.indicators.rsiLength ?? 14,
    refresh = false,
  } = {},
) {
  const normalizedInterval = String(interval || "15_MINUTE")
    .trim()
    .toUpperCase();
  const search = new URLSearchParams({
    interval: normalizedInterval,
    candles: String(candles),
    rsiLength: String(rsiLength),
  });
  if (refresh) search.set("refresh", "1");

  const payload = await agentMeridianJson(
    `/chart-indicators/${mint}?${search.toString()}`,
    { headers: getAgentMeridianHeaders() },
  );

  // Backend ignores rsiLength param — compute RSI locally from candle data
  if (payload?.candles?.length && rsiLength > 0) {
    const localRSI = computeLocalRSI(payload.candles, rsiLength);
    if (localRSI != null) {
      if (!payload.latest) payload.latest = {};
      if (!payload.latest.rsi) payload.latest.rsi = {};
      const backendRSI = payload.latest.rsi.value;
      payload.latest.rsi.value = localRSI;
      payload.latest.rsi._local = true;
      payload.latest.rsi._rsiLength = rsiLength;
      log(
        "rsi_local",
        `${mint.slice(0, 8)} RSI override: backend=${backendRSI} → local(${rsiLength})=${localRSI}`,
      );
    }
  }

  return payload;
}

export async function confirmIndicatorPreset({
  mint,
  side,
  preset = side === "entry"
    ? config.indicators.entryPreset
    : config.indicators.exitPreset,
  intervals = config.indicators.intervals,
  refresh = false,
} = {}) {
  if (!config.indicators.enabled || !mint || !preset) {
    return {
      enabled: false,
      confirmed: true,
      reason: "Indicators disabled or not configured",
      intervals: [],
    };
  }

  const targets = normalizeIntervals(intervals);
  if (targets.length === 0) {
    return {
      enabled: false,
      confirmed: true,
      reason: "No indicator intervals configured",
      intervals: [],
    };
  }

  const results = [];
  for (const interval of targets) {
    try {
      const payload = await fetchChartIndicatorsForMint(mint, {
        interval,
        refresh,
      });
      const evaluation = evaluatePreset(side, preset, payload);
      results.push({
        interval,
        ok: true,
        confirmed: !!evaluation.confirmed,
        reason: evaluation.reason,
        signal: evaluation.signal,
        latest: payload?.latest || null,
      });
    } catch (error) {
      log(
        "indicators_warn",
        `Indicator fetch failed for ${mint.slice(0, 8)} ${interval}: ${error.message}`,
      );
      results.push({
        interval,
        ok: false,
        confirmed: null,
        reason: error.message,
        signal: null,
        latest: null,
      });
    }
  }

  const successful = results.filter((entry) => entry.ok);
  if (successful.length === 0) {
    return {
      enabled: true,
      confirmed: true,
      skipped: true,
      preset,
      side,
      reason: "Indicator API unavailable; falling back to existing logic",
      intervals: results,
    };
  }

  const requireAll = !!config.indicators.requireAllIntervals;
  const confirmed = requireAll
    ? successful.every((entry) => entry.confirmed)
    : successful.some((entry) => entry.confirmed);

  return {
    enabled: true,
    confirmed,
    skipped: false,
    preset,
    side,
    requireAllIntervals: requireAll,
    reason: confirmed
      ? `${preset} confirmed on ${successful
          .filter((entry) => entry.confirmed)
          .map((entry) => entry.interval)
          .join(", ")}`
      : `${preset} not confirmed on ${successful.map((entry) => entry.interval).join(", ")}`,
    intervals: results,
  };
}

/**
 * Evaluate a GMGN-style bounce setup from indicator payload data.
 * Pure evaluator — no API calls.
 */
export function evaluateBounceSetup(payload, rules = {}) {
  const latest = payload?.latest || {};
  const st = latest?.supertrend || {};
  const stDirection = String(st.direction || "").toLowerCase();
  const stBreakUp = !!latest?.states?.supertrendBreakUp;
  const close = Number(latest?.candle?.close) || 0;
  const rsiValue = Number(latest?.rsi?.value);
  const bb = latest?.bollinger || {};
  const upperBand = Number(bb.upper) || 0;
  const lowerBand = Number(bb.lower) || 0;
  const oversold = Number(config.indicators?.rsiOversold ?? 35);
  const overbought = Number(config.indicators?.rsiOverbought ?? 80);
  const stValue = Number(st.value) || 0;

  const isBullish = stDirection === "bullish" || stBreakUp;
  const alreadyAtBottom =
    Number.isFinite(rsiValue) &&
    rsiValue < oversold &&
    close > 0 &&
    lowerBand > 0 &&
    close < lowerBand;
  const priceAboveSupertrend = close > 0 && stValue > 0 && close >= stValue;

  let bbPosition = "inside";
  if (close > 0 && upperBand > 0 && close > upperBand) bbPosition = "above";
  else if (close > 0 && lowerBand > 0 && close < lowerBand)
    bbPosition = "below";

  let rsiLabel = null;
  if (Number.isFinite(rsiValue)) {
    if (rsiValue < 35) rsiLabel = "oversold";
    else if (rsiValue > 65) rsiLabel = "overbought";
    else rsiLabel = "neutral";
  }

  const reasons = [];

  if (rules.requireBullishSupertrend !== false && !isBullish)
    reasons.push(`no bounce support: ${stDirection} supertrend`);

  if (rules.rejectAlreadyAtBottom !== false && alreadyAtBottom)
    reasons.push(
      `already at bottom: RSI ${rsiValue.toFixed(1)}, price below lower BB`,
    );

  if (rules.requireAboveSupertrend && !priceAboveSupertrend)
    reasons.push(`price below supertrend (${stValue})`);

  if (
    rules.minRsi != null &&
    Number.isFinite(rsiValue) &&
    rsiValue < rules.minRsi
  )
    reasons.push(`RSI ${rsiValue.toFixed(1)} < min ${rules.minRsi}`);

  if (
    rules.maxRsi != null &&
    Number.isFinite(rsiValue) &&
    rsiValue > rules.maxRsi
  )
    reasons.push(`RSI ${rsiValue.toFixed(1)} > max ${rules.maxRsi}`);

  if (rules.requireBbPosition != null && bbPosition !== rules.requireBbPosition)
    reasons.push(
      `BB position ${bbPosition} != required ${rules.requireBbPosition}`,
    );

  return {
    passed: reasons.length === 0,
    reasons,
    signal: {
      interval: null, // caller sets this
      rsi: Number.isFinite(rsiValue) ? Number(rsiValue.toFixed(1)) : null,
      rsiLabel,
      bbPosition,
      supertrendDirection: stDirection || null,
      supertrendBreakUp: stBreakUp,
      aboveSupertrend: close > 0 && stValue > 0 ? close >= stValue : null,
    },
  };
}

/**
 * Fetch chart indicators for a mint and evaluate GMGN-style bounce setup.
 */
export async function confirmBounceSetup({
  mint,
  interval = config.indicators.bounceInterval ?? "15_MINUTE",
  rules = config.indicators.bounceRules,
} = {}) {
  if (!mint) {
    return {
      enabled: false,
      passed: true,
      skipped: true,
      reason: "No mint provided",
      signal: null,
    };
  }
  try {
    const payload = await fetchChartIndicatorsForMint(mint, { interval });
    const result = evaluateBounceSetup(payload, rules);
    result.signal = { ...result.signal, interval };
    return { enabled: true, ...result, skipped: false };
  } catch (error) {
    log(
      "indicators_warn",
      `Bounce indicator fetch failed for ${mint.slice(0, 8)}: ${error.message}`,
    );
    return {
      enabled: true,
      passed: true,
      skipped: true,
      reason: `Indicator API unavailable: ${error.message}`,
      signal: null,
    };
  }
}
