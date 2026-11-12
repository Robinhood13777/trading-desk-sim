# Grok Bot × Trading Desk · SIM

Live dashboard of a **simulation-only** 7-agent trading desk (Desk Lead, Gold Bot, Oil Bot, SP100 Bot, SP500 Bot, Risk Manager, Reporter).
Assets: Gold `GC=F`, WTI `CL=F`, S&P 100 `^OEX`, S&P 500 `^GSPC` (Yahoo Finance). $1000 virtual start, 50x isolated, trailing stop, 1.5% risk/trade, −5% daily stop.

`data.json` is exported from the engine roughly every 2 minutes; the page polls it every 30 s. GitHub Pages CDN may add up to ~10 min of lag.

**SIM · ILLUSTRATIVE FILLS · NOT A REAL ACCOUNT.** No real orders are placed.
