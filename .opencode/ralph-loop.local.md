---
active: true
iteration: 68
maxIterations: 100
---

keep playing get better every run be bol

## MEASURED ON THE WIRE: BOTH OF LAST ITERATION'S CLAIMS WERE WRONG
Added `requestBytes` and per-part `requestPartBytes` to every decision — the byte count of the
body actually sent, plus each part of the payload. It takes one field and settles the question.

  monster  wire=82.3 KB  in=24241 tok  lat=529 ms
      state          45.1 KB   55%
      questions      37.1 KB   45%
  monster  wire=73.1 KB  in=21763 tok  lat=546 ms
  monster  wire=70.3 KB  in=20976 tok  lat=406 ms

**Claim 1 was wrong.** I said 71.7 KB of candidates was 81% of the payload. The logged candidate
list is not what gets sent; `state` is 55% and `questions` 45%, and candidates are not the story.

**Claim 2 was worse.** I said timeouts followed the 26,471-token decision. The last SUCCESSFUL
decision before the three timeouts was 7,062 tokens at 07:04:25 — the smallest in that stretch, not
the largest. And these measurements run 20-24k tokens at 406-546 ms with no trouble at all. So
payload size does not explain the timeouts, and the batch is running again now without any change
to prompt size.

The correlation I saw was an artefact of listing token counts and then assuming the failures came
after the big ones. I never checked where the failures actually sat in the sequence. That is the
same failure as the two before it — a plausible story built on numbers I had not lined up against
the thing I was explaining.

## What is still true, and worth doing for its own sake
20-24k input tokens to choose a card in a trash mob is genuinely wasteful — it is 55% `state` and
45% `questions`, and it is the bill. Latency is fine (p50 270ms) so this is a COST and context-
window problem, not a reliability one. Worth trimming on those grounds alone, and the measurement
above says where to look: `state`, not candidates.

## The lesson, and it is the third time
I have now told a tidy causal story three iterations running and been wrong three times. Each time
the instrument existed and I reached for reasoning instead. The one thing that worked — logging
attrition — worked because it put a number on live data that contradicted me within a minute.

The timeouts themselves remain unexplained. Three consecutive, now recovered, with no code change
and no size correlation. Most likely transient upstream. **Not diagnosed, and I am not going to
write a story about it.**

## Loop state
555 tests green · wire measurement shipped · batch running
