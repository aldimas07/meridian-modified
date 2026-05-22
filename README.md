# Meridian (Modified)

**Autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs.**

**Links:** [Website](https://agentmeridian.xyz) | [Telegram](https://t.me/agentmeridian) | [X](https://x.com/meridian_agent)

Fork of [yunus-0x/meridian](https://github.com/yunus-0x/meridian) — merges `main` + `experimental` branches and adds production-hardened features.

---

## Feature Differences from Upstream

This fork (`meridian-modified`) includes everything from both upstream `main` and `experimental` branches, plus the following additions:

### Screening & Deploy

| Feature | Description |
|---|---|
| **GMGN Screening Pipeline** | Alternative screening source via GMGN API (`screeningSource: "gmgn"`). Adds smart degen count, KOL tracking, bundler rate, rug ratio, fresh wallet rate, sniper detection, and indicator-based filtering. Full config with `gmgn*` prefix keys. |
| **Price Deviation Check** | Pre-deploy validation compares pool price against Jupiter market price. Rejects deploy if deviation exceeds `maxPriceDeviationPct` (default 5%). Prevents arbitrage loss from stale/manipulated pool prices. |
| **Volatility-Based Strategy Selection** | Auto-selects `bid_ask` for low volatility (<4.0) and `spot` for high volatility (>=4.0). Enforced at code level in executor.js. Configurable via `strategyVolatilityThreshold`. |
| **Chart Indicators (Bounce Mode)** | RSI + Bollinger Band bounce detection for entry timing. Configurable via `chartIndicators` object with `rsiLength`, `bounceInterval`, `rsiOversold`, `rsiOverbought`, `requireBbPosition`. |
| **Repeat Deploy Cooldown** | Prevents re-deploying into the same token too quickly. Configurable trigger count, cooldown hours, scope (token/pool), and minimum fee earned threshold. |
| **Fee-Based Take Profit** | `takeProfitFeePct` — close when unclaimed fees reach X% of position value (separate from floating PnL TP). |

### Risk & Management

| Feature | Description |
|---|---|
| **Emergency Price Drop** | `emergencyPriceDropPct` — force-close position if token price drops beyond threshold, independent of stop-loss. |
| **Fallback LLM Provider** | Cascade to a secondary LLM provider on 502/503/529 errors. Configured via `fallbackProvider` object with separate model per role. |
| **Dead-Flow Exit (Rule 8)** | Closes profitable in-range positions when pool volume and fee/TVL collapse. Prevents capital sitting idle. Configurable via `deadFlowExit*` keys. |
| **Rule Proximity Detection** | Computes distance to every deterministic close rule and displays nearest one in Telegram report. Pure JS, zero LLM cost. |
| **Bin Progress Bar** | Visual `[████████░░░░░░░░░░░░]` indicator showing active bin position within range. Appears in Telegram reports and `/positions`. |

### Infrastructure

| Feature | Description |
|---|---|
| **Discord Signal Listener** | Selfbot listener watches LP Army channels for token calls, pre-checks (dedup, blacklist, rug check, fee check), and queues for screener. |
| **Agent Meridian Integration** | `agent-meridian.js` — relay deploy via Agent Meridian API for gasless/optimized execution. |
| **Signal Tracker** | `signal-tracker.js` — tracks and weights signals from multiple sources (Discord, GMGN, screening). |

---

## What it does

- **Screens pools** — scans Meteora DLMM pools (or GMGN pipeline) against configurable thresholds and surfaces high-quality opportunities
- **Manages positions** — monitors, claims fees, and closes LP positions autonomously based on live PnL, yield, range data, and 8 deterministic rules
- **Learns from performance** — studies top LPers, saves structured lessons, and evolves screening thresholds based on closed position history
- **Telegram chat** — full agent chat via Telegram, plus cycle reports, OOR alerts, and proximity warnings

---

## How it works

Meridian runs a **ReAct agent loop** — each cycle the LLM reasons over live data, calls tools, and acts. Two specialized agents run on independent cron schedules:

| Agent | Default interval | Role |
|---|---|---|
| **Screening Agent** | Every 30 min | Pool screening — finds and deploys into the best candidate |
| **Management Agent** | Every 10 min | Position management — evaluates each open position and acts |

**Data sources:**
- `@meteora-ag/dlmm` SDK — on-chain position data, active bin, deploy/close transactions
- Meteora DLMM PnL API — position yield, fee accrual, PnL
- OKX OnchainOS — smart money signals, token risk scoring
- GMGN API — smart degen, KOL, bundler, rug ratio analysis
- Jupiter API — token audit, mcap, launchpad, price stats
- Helius — wallet balances, SOL price

---

## Requirements

- Node.js 18+
- LLM API key (OpenRouter, MiMo, or any OpenAI-compatible provider)
- Solana wallet (base58 private key)
- Solana RPC endpoint ([Helius](https://helius.xyz) recommended)
- Telegram bot token (optional)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/aldimas07/meridian-modified.git
cd meridian-modified
npm install
```

### 2. Configure

Create `.env`:

```env
WALLET_PRIVATE_KEY=your_base58_private_key
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_API_KEY=***                    # for wallet balance lookups
TELEGRAM_BOT_TOKEN=***                # optional — for notifications + chat
TELEGRAM_CHAT_ID=                     # auto-filled on first message
TELEGRAM_ALLOWED_USER_IDS=            # comma-separated Telegram user IDs
DRY_RUN=true                          # set false for live trading
```

Copy config and edit:

```bash
cp user-config.example.json user-config.json
```

See [Config reference](#config-reference) below.

### 3. Run

```bash
npm run dev    # dry run — no on-chain transactions
npm start      # live mode
```

### PM2 (recommended for VPS)

```bash
npm install
npm run pm2:start
pm2 save
```

Update existing PM2:

```bash
git pull
npm install
npm run pm2:restart
```

---

## Running modes

### Autonomous agent

```bash
npm start
```

REPL commands:

| Command | Description |
|---|---|
| `/status` | Wallet balance and open positions |
| `/candidates` | Re-screen and display top pool candidates |
| `/learn` | Study top LPers across all current candidate pools |
| `/thresholds` | Current screening thresholds and performance stats |
| `/evolve` | Trigger threshold evolution (needs 5+ closed positions) |
| `/stop` | Graceful shutdown |
| `<anything>` | Free-form chat — ask the agent anything |

### Claude Code terminal

```bash
cd meridian
claude
```

Slash commands: `/screen`, `/manage`, `/balance`, `/positions`, `/candidates`, `/study-pool`, `/pool-ohlcv`, `/pool-compare`

---

## Telegram

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Add `TELEGRAM_BOT_TOKEN=<token>` to `.env`
3. Set `TELEGRAM_CHAT_ID` and `TELEGRAM_ALLOWED_USER_IDS`

### Notifications

- Management cycle reports (reasoning + decisions)
- Screening cycle reports (what it found, whether it deployed)
- OOR alerts when position leaves range past `outOfRangeWaitMinutes`
- Deploy/close notifications with tx details

### Commands

| Command | Action |
|---|---|
| `/positions` | List open positions with progress bar |
| `/close <n>` | Close position by list index |
| `/set <n> <note>` | Set a note on a position |

---

## Discord listener

Watches configured channels for Solana token calls and queues them as signals for the screener.

```bash
cd discord-listener
npm install
npm start
```

Add to `.env`:

```env
DISCORD_USER_TOKEN=your_discord_account_token
DISCORD_GUILD_ID=the_server_id
DISCORD_CHANNEL_IDS=channel1,channel2
DISCORD_MIN_FEES_SOL=5
```

---

## Config reference

All fields are optional — defaults shown. Edit `user-config.json`.

### Screening

| Field | Default | Description |
|---|---|---|
| `screeningSource` | `"meteora"` | Screening pipeline: `meteora` or `gmgn` |
| `minFeeActiveTvlRatio` | `0.05` | Minimum fee/active-TVL ratio |
| `minTvl` | `10000` | Minimum pool TVL (USD) |
| `maxTvl` | `150000` | Maximum pool TVL (USD) |
| `minVolume` | `500` | Minimum pool volume |
| `minOrganic` | `60` | Minimum organic score (0-100) |
| `minHolders` | `500` | Minimum token holder count |
| `minMcap` | `150000` | Minimum market cap (USD) |
| `maxMcap` | `10000000` | Maximum market cap (USD) |
| `minBinStep` | `80` | Minimum bin step |
| `maxBinStep` | `125` | Maximum bin step |
| `timeframe` | `"5m"` | Candle timeframe for screening |
| `category` | `"trending"` | Pool category filter |
| `minTokenFeesSol` | `30` | Minimum all-time fees in SOL |
| `maxBundlePct` | `30` | Maximum bundler % in top holders |
| `maxBotHoldersPct` | `30` | Maximum bot holder % |
| `maxTop10Pct` | `60` | Maximum top-10 holder concentration |
| `maxPriceDeviationPct` | `5` | Max pool-vs-Jupiter price deviation % before deploy |
| `blockedLaunchpads` | `[]` | Launchpad names to never deploy into |
| `minTokenAgeHours` | `null` | Minimum token age (hours) |
| `maxTokenAgeHours` | `null` | Maximum token age (hours) |
| `athFilterPct` | `null` | Deploy only if price is X% below ATH |
| `maxVolatility` | `5.0` | Evolved by Darwin; ceiling for pool volatility |
| `strategyVolatilityThreshold` | `4.0` | Vol >= this → spot; vol < this → bid_ask |

### Management

| Field | Default | Description |
|---|---|---|
| `deployAmountSol` | `0.5` | Base SOL per new position |
| `positionSizePct` | `0.35` | Fraction of deployable balance to use |
| `maxDeployAmount` | `50` | Maximum SOL cap per position |
| `gasReserve` | `0.2` | Minimum SOL to keep for gas |
| `minSolToOpen` | `0.55` | Minimum wallet SOL before opening |
| `outOfRangeWaitMinutes` | `30` | Minutes OOR before acting |
| `stopLossPct` | `-50` | Close if price drops by this % |
| `takeProfitPct` | `5` | Close when floating PnL reaches this % |
| `takeProfitFeePct` | `null` | Close when unclaimed fees reach X% of position value |
| `emergencyPriceDropPct` | `null` | Force-close on token price drop beyond threshold |
| `trailingTakeProfit` | `true` | Enable trailing take profit |
| `trailingTriggerPct` | `3` | Trailing TP activation threshold % |
| `trailingDropPct` | `1.5` | Trailing TP drop % from peak to close |
| `minClaimAmount` | `5` | Minimum unclaimed fees (USD) to claim |
| `autoSwapAfterClaim` | `false` | Auto-swap claimed tokens to SOL |
| `solMode` | `false` | SOL-only mode |

### Repeat Deploy Cooldown

| Field | Default | Description |
|---|---|---|
| `repeatDeployCooldownEnabled` | `false` | Enable cooldown between re-deploys |
| `repeatDeployCooldownTriggerCount` | `3` | Deploys before cooldown activates |
| `repeatDeployCooldownHours` | `12` | Cooldown duration (hours) |
| `repeatDeployCooldownScope` | `"token"` | Scope: `token` or `pool` |
| `repeatDeployCooldownMinFeeEarnedPct` | `0` | Min fee earned % before cooldown resets |

### Dead-Flow Exit

| Field | Default | Description |
|---|---|---|
| `deadFlowExitEnabled` | `false` | Enable dead-flow exit rule |
| `deadFlowExitAgeMinutes` | `180` | Minimum position age before rule applies |
| `deadFlowExitUnclaimedUsd` | `0.10` | Max unclaimed fees to consider "near zero" |
| `deadFlowExitVolume` | `500` | Pool volume threshold (USD) |
| `deadFlowExitFeeTvlRatio` | `0.05` | Fee/active-TVL ratio threshold |

### Strategy

| Field | Default | Description |
|---|---|---|
| `minBinsBelow` | `35` | Minimum bins below active bin |
| `maxBinsBelow` | `69` | Maximum bins below active bin |
| `defaultBinsBelow` | `69` | Default bins below when volatility unavailable |

### Darwin Evolution

| Field | Default | Description |
|---|---|---|
| `darwinEnabled` | `true` | Enable Darwin threshold evolution |
| `darwinWindowDays` | `60` | Performance lookback window |
| `darwinRecalcEvery` | `5` | Recalculate every N closes |
| `darwinBoost` | `1.05` | Boost factor for winners |
| `darwinDecay` | `0.95` | Decay factor for losers |
| `darwinFloor` | `0.3` | Minimum threshold multiplier |
| `darwinCeiling` | `2.5` | Maximum threshold multiplier |

### GMGN Pipeline

| Field | Default | Description |
|---|---|---|
| `gmgnApiKey` | — | GMGN API key |
| `gmgnInterval` | `"5m"` | Token discovery timeframe |
| `gmgnMinMcap` | `150000` | Minimum market cap |
| `gmgnMaxMcap` | `8000000` | Maximum market cap |
| `gmgnMinHolders` | `800` | Minimum holder count |
| `gmgnMinSmartDegenCount` | `1` | Minimum smart degen wallets |
| `gmgnRequireKol` | `true` | Require KOL presence |
| `gmgnMaxBundlerRate` | `0.5` | Max bundler rate |
| `gmgnMaxBotDegenRate` | `0.4` | Max bot degen rate |
| `gmgnMaxRugRatio` | `0.3` | Max rug ratio |
| `gmgnFilters` | `["renounced","frozen","not_wash_trading"]` | GMGN token filters |
| `gmgnPlatforms` | `["Pump.fun","meteora_virtual_curve","pool_meteora"]` | Source platforms |

### Chart Indicators

| Field | Default | Description |
|---|---|---|
| `chartIndicators.enabled` | `false` | Enable chart indicator filtering |
| `chartIndicators.mode` | `"bounce"` | Entry mode: `bounce` or `breakout` |
| `chartIndicators.rsiLength` | `14` | RSI period length |
| `chartIndicators.bounceInterval` | `"15_MINUTE"` | Candle interval for bounce detection |
| `chartIndicators.rsiOversold` | `30` | RSI oversold threshold |
| `chartIndicators.rsiOverbought` | `80` | RSI overbought threshold |

### Schedule

| Field | Default | Description |
|---|---|---|
| `managementIntervalMin` | `10` | Management cycle frequency (minutes) |
| `screeningIntervalMin` | `30` | Screening cycle frequency (minutes) |
| `healthCheckIntervalMin` | `60` | Health check frequency (minutes) |

### Models

| Field | Default | Description |
|---|---|---|
| `managementModel` | `openrouter/healer-alpha` | LLM for management cycles |
| `screeningModel` | `openrouter/hunter-alpha` | LLM for screening cycles |
| `generalModel` | `openrouter/healer-alpha` | LLM for REPL / chat |
| `temperature` | `0.373` | LLM temperature |
| `maxTokens` | `4096` | Max output tokens |
| `maxSteps` | `20` | Max ReAct loop steps |

### Fallback Provider

| Field | Default | Description |
|---|---|---|
| `fallbackProvider.baseUrl` | — | Fallback LLM API base URL |
| `fallbackProvider.apiKey` | — | Fallback API key |
| `fallbackProvider.model` | — | Default fallback model |
| `fallbackProvider.screeningModel` | — | Screening-specific fallback |
| `fallbackProvider.managementModel` | — | Management-specific fallback |
| `fallbackProvider.generalModel` | — | General-specific fallback |

### HiveMind

| Field | Default | Description |
|---|---|---|
| `agentId` | `""` | Auto-generated if empty |
| `hiveMindUrl` | `""` | Falls back to Agent Meridian defaults |
| `hiveMindApiKey` | `""` | Private API key (optional) |
| `hiveMindPullMode` | `"auto"` | `auto` or `manual` |

---

## How it learns

### Lessons

After every closed position the agent studies top LPers, analyzes on-chain behavior, and saves concrete lessons. Lessons are injected into subsequent agent cycles.

```bash
node cli.js lessons add "Never deploy into pump.fun tokens under 2h old"
```

### Threshold evolution

After 5+ closed positions:

```bash
node cli.js evolve
```

Analyzes closed position performance and adjusts screening thresholds in `user-config.json`. Changes take effect immediately.

### Darwin

Darwin auto-evolves screening thresholds based on winner vs loser patterns. Runs every `darwinRecalcEvery` closes. Boosts thresholds that correlate with winners, decays those that correlate with losers.

---

## Architecture

```
index.js              Main entry: REPL + cron orchestration + Telegram bot polling
agent.js              ReAct loop: LLM -> tool call -> repeat
config.js             Runtime config from user-config.json + .env
prompt.js             System prompt builder (SCREENER / MANAGER / GENERAL roles)
state.js              Position registry (state.json)
decision-log.js       Structured decision log for deploy/close/skip rationale
lessons.js            Learning engine: records performance, derives lessons, evolves thresholds
pool-memory.js        Per-pool deploy history + snapshots
strategy-library.js   Saved LP strategies (volatility-based selection)
telegram.js           Telegram bot: polling + notifications
hivemind.js           Agent Meridian HiveMind sync
signal-tracker.js     Signal tracking and weighting
smart-wallets.js      KOL/alpha wallet tracker
token-blacklist.js    Permanent token blacklist
cli.js                Direct CLI: every tool as a subcommand

tools/
  definitions.js      Tool schemas (OpenAI format)
  executor.js         Tool dispatch + safety checks
  dlmm.js             Meteora DLMM SDK wrapper
  screening.js        Pool discovery (Meteora API)
  gmgn.js             GMGN screening pipeline
  wallet.js           SOL/token balances + Jupiter swap + price check
  token.js            Token info, holders, narrative
  study.js            Top LPer study via LPAgent API
  agent-meridian.js   Agent Meridian relay deploy
  okx.js              OKX OnchainOS risk analysis

discord-listener/
  index.js            Selfbot Discord listener
  pre-checks.js       Signal pre-check pipeline
```

---

## Disclaimer

This software is provided as-is, with no warranty. Running an autonomous trading agent carries real financial risk — you can lose funds. Always start with `DRY_RUN=true` to verify behavior before going live. Never deploy more capital than you can afford to lose. This is not financial advice.
