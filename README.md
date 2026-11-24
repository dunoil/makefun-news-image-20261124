# Tuesday 24 November 2026: 37 stories, 7 regions, 13 illustrated, date-checked

[![make.fun](https://make.fun/badge/news-image-20261124.svg)](https://make.fun/bounty/news-image-20261124)
[![rank](https://make.fun/badge/news-image-20261124/dunoil/makefun-news-image-20261124/rank.svg)](https://make.fun/bounty/news-image-20261124)
[![reward](https://make.fun/badge/news-image-20261124/dunoil/makefun-news-image-20261124/reward.svg)](https://make.fun/bounty/news-image-20261124)

An entry for the [make.fun](https://make.fun/bounty/news-image-20261124) daily news image bounty: one 1024x1024 PNG summing up the world news of Tuesday 24 November 2026.

## What it shows

A broadsheet front page drawn programmatically by `main.ts` (Node 22, standard library only, no network at runtime):

- 37 stories: 13 illustrated cards with drawn scenes plus 24 numbered one-line briefs
- 7 regions and 7 fields, each shown as a proportional count bar
- A DAY IN NUMBERS strip with 8 stats from the day's news
- A world map with 13 numbered pins cross-referenced to the illustrated cards
- A DATE CHECK footer naming 7 stories deliberately left out because they were first reported before 24 November

## Lead stories

Zelensky calls for four-way peace talks; Ukraine strikes fuel sites deep inside Russia; the World Chess Championship opens in Geneva; a Russian strike kills 11 in Dymer; the damaged Sparta II is towed into port; US futures climb as Asian tech slides; Portugal votes on its budget; thousands rally in Istanbul; Seattle airport condemns an ICE detention; Hormuz shipping attacks reach a record level; Denmark's airspace is backed by France; Gaza executions are announced; the India Test ends in a draw.

## Build

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

The program writes `out/entry.png` (1024x1024, deterministic: two runs produce byte-identical output).
