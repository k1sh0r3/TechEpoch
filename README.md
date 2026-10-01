# Tech_Epoch

**Every epoch of tech, daily.**

🌐 **Live site:** https://k1sh0r3.github.io/Tech_Epoch/
📦 **Repo:** https://github.com/k1sh0r3/Tech_Epoch

A tech news feed with ranking priority on **AI, Machine Learning and Robotics**. A scheduled pipeline collects stories from public keyless sources four times a day, classifies and ranks them, and publishes a static feed.

## Sources (all keyless)

| Source | What |
|---|---|
| Hacker News (Algolia API) | Front page + targeted AI/robotics searches |
| arXiv API | Newest cs.AI / cs.LG / cs.CL / cs.RO / cs.CV papers |
| Reddit (RSS) | r/MachineLearning, r/artificial, r/technology, r/robotics |
| RSS | Google AI Blog, MIT Technology Review, Ars Technica |

## Sharing

Every story has a share button:

- **One tap:** LinkedIn, X, Facebook, WhatsApp, Telegram (native share URLs)
- **Instagram:** the site draws a 1080×1920 story card in your browser (headline, source, branding) for download, plus a pre-written caption with hashtags to copy. Instagram offers no web posting API, so this is the standard download → post → paste-caption flow.

## How ranking works

Stories are classified into AI / Robotics / Machine Learning / Research / Tech. AI, Robotics and ML are boosted above general tech, then ordered by keyword relevance, community signal (e.g. HN points) and recency. Cross-source duplicates are merged.

## Fair use

Headlines, short summaries and links only — full articles live with their publishers.

## Run the aggregator locally

```bash
node scripts/aggregate.js   # writes data/feed.json
```

Zero npm dependencies. The GitHub Actions workflow (`.github/workflows/aggregate.yml`) runs it every 6 hours and commits the updated feed.
