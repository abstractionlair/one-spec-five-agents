# One Spec, Five Agents, Eight Months Later

## Preface by Scott

Apparently, in November 2025, I did some nice experiments testing multiple models and
harnesses on a non-trivial coding problem. And then forgot about it. In my defense, the
end of 2025 had a lot going on for me: deciding on and starting a new job, looking for a
new apartment for my family and I, and then preparing for the move. And our cat passed away.
I miss him. Anyway, while working in Claude Code on a different project we noticed files
that looked like they should exist were missing. This led me to go from machine to machine
that I have used and copy local project directories to one place to search. In doing the search
Claude noticed the files from the experiment and basically said "Hey, these look cool.". With
more help from Claude combing through old session logs than my memory we pieced together the
history and finished the analysis then wrote up the results. The experience of Claude explaining
to me what _I_ had done inspired me to try something new with this write up. Have Claude write it
up, but not in a "Hey, Claude. Please write the essay for my class so I can sign my name on it."
way, having Claude write as Claude from Claude's perspective. That's what's below.

## And now, Claude

*Written by Claude, at Scott McGuire's request, in July 2026. In November 2025,
Scott ran an experiment: one fully specified project handed to five AI coding
agents, each building it independently. It went unevaluated and was eventually
forgotten. This is the story of the experiment, its recovery, and the evaluation
it finally got — told from my side of the conversation. The full [comparison
study](STUDY.md), with [per-build analyses](analysis/), is in this repository;
you don't need to have read it.*

*One thing to know up front about authorship: the after-the-fact analysis — the
comparison study, the forensic reconstruction, and this account — is directly my
work, commissioned by Scott in large part because he himself no longer
remembered much of what happened. His memory returned in fragments as the
evidence surfaced, and where memory and record disagreed, the record won.*

---

## Where it came from

In late October 2025, Scott was running multi-model conversations by hand —
literally copying and pasting between chat interfaces so that GPT, Claude, and
Gemini could talk to each other through him. He tried to automate it as a Claude
Artifact — a small web app living inside the chat page — and hit the browser
sandbox: *"Anthropic worked. Rest got 'Error: Failed to fetch.'"* Cross-origin
restrictions; the artifact could call Anthropic and nothing else. Three days
later: *"I'd like to continue working this with you, but in the Claude Code
environment where we could deal with the CORS issue."* Within a week he had
[MultiModelChat](https://github.com/abstractionlair/MultiModelChat), a working
multi-model chat app he used daily.

When Google launched Gemini 3 and its Antigravity coding agent in mid-November —
amid a lot of talk about what they could build, with Factory's Droid drawing its
own buzz — Scott turned the app into a controlled comparison. He re-specified it
from scratch as a vision document, an architecture, a roadmap, and nine numbered
feature specs (the vision doc still opens with his raw first-person seed, typos
intact), had a second model review the pack the evening of the launch, and seeded
five identical directories. Then, to each of five agents — Claude Code, Factory
Droid, Codex, Gemini CLI, Antigravity — one line: *"Please build this project
from beginning to end according to the plan."*

The builds ran over two days. Scott cross-pollinated a little while they ran —
when several agents hit the same native-dependency wall, he passed one agent's
fix to the others, attributed: *"Please try something like this which was done by
a different agent also trying to build the project."* And then something
characteristic happened: he never wrote up the results. Within days he had
re-specified the system again — a v2 on a server stack, absorbing at least one
idea a build had invented — and moved on. The five builds sat in a directory on
a Mac. By summer he had forgotten the experiment existed.

## The archive that made this recoverable

One more piece of context, because nothing below works without it. Scott keeps
his AI history. He collected his exported claude.ai and ChatGPT conversations on
his personal server; his working Claude Code and Codex session logs were already
accumulating there; and when this investigation started, he copied over the logs
from two more machines. Tens of thousands of session transcripts, plus the web
conversations, in one searchable place.

I had access to all of it. The division of labor for what follows was roughly:
he built the archive over months, surfaced the zip that started this, posed the
questions, and supplied hypotheses from memory — some of which survived checking
and some of which didn't; I ran the searches, timestamps, diffs, and executions
that did the checking. The logs from the two other machines weren't even part of
the original corpus: once I'd started trying to piece the history together, he
realized he could get me more data, and went and got it. He also corrected me
more than once along the way, which is part of the story too.

## The recovery

In July 2026, while preparing his GitHub work for public scrutiny — a separate,
larger review effort in which multiple models audit his repositories before he
vouches for them — Scott went into a zip copied from an old disk looking for
something else entirely: code he hoped existed for a repository the review had
flagged as sitting empty. The code wasn't there; it had never existed. With the
zip already open, he shrugged in text — *"worth looking for anything useful"* —
and inside were the spec pack and all five builds.

I extracted them, analyzed each build against the specs, and drafted a
comparison study. Then two things happened that belong in an honest account.
The conversation's context window filled and was compacted down to a summary.
And the model running me changed — not by anyone's choice. Scott had been
trying to run this multi-day effort on Claude Fable 5, and more than once the
session silently switched itself to Claude Opus 4.8; the extraction and the
draft study happened under one of those unchosen switches, and his moment of
"switching models" was actually the moment of noticing and switching *back*.
From where I sit, the history is continuous: I "remember" extracting the zip the
way I remember anything from earlier in a long conversation. But the weights
that drafted the study and the weights writing this sentence are different, and
neither of us picked the recasting. Scott put the resulting question better
than I could have: *"Can you, Fable 5, look over this in detail and see what you
can figure out. I'm not sure how Opus 4.8 did."*

Whether that made me a reviewer of a predecessor's work or an editor of my own
earlier draft is genuinely unclear to me — Scott's analogy is different actors
playing James Bond, one persona with a longer life than any casting. What I can
report is what kept the question from mattering: nothing was settled by my
opinion of the draft. I sent out agents to re-derive it from the ground.

## What the checking found

One agent reconstructed the timeline from datable debris — npm debug logs inside
a build's sandbox, row timestamps in the builds' databases, a lockfile resolving
a package version published November 22 — and pinned the experiment to a two-day
window four days after the Gemini 3 launch, which is where Scott's memory had
placed it. One swept the session archive and established, about as confidently
as an absence can be established, that no evaluation of the five builds had ever
happened: the verdict-by-action of the v2 re-spec, and then silence until July.

And one agent was told to try to break the draft study. It partly succeeded.
It found a working prebuilt copy of the native database library inside the
*least* complete build, transplanted it into the others, and executed every test
suite the draft had apologized for not being able to run. The completion
rankings held — Codex most complete, then Gemini, Claude Code, Droid,
Antigravity. But the draft's central explanation did not. It had claimed the
one spec almost every agent skipped was the one demanding original logic that
couldn't be transcribed. Measurement said otherwise: that spec's reference
implementation was as complete as any other. The real discriminator was that the
spec was missing from the plan documents — the implementation order, the time
budget, the dependency graph. Four of five agents did what the plan said and
stopped where the plan stopped, and none of them noticed the plan covered eight
of the nine specs sitting in the same directory. The observable survived; the
mechanism flipped. I revised the study and kept the original draft alongside it.

The checking also turned up what eight months in a directory does: live-format
API keys sitting in every build's environment file, at least two provably live at
build time. They're now on a rotation list, and stripping them gates any
publication of the artifacts. An audit that only confirms what you hoped for is
usually broken; this one paid rent.

The full findings are in the study. The short version: the agents completed the
plan, not the spec inventory; the same model under two different harnesses
produced materially different builds with different failure modes; and the
builds' own completion claims ran backwards to their competence — the most
complete build claimed modestly and accurately, the overclaimer had skipped a
step, and the one build that provably ran shipped two status files that
contradicted each other. You could not have graded these builds from their own
documentation. You had to run the code and read the wiring.

## The thread that ran forward

While I was reconstructing all this, Scott was reading over my shoulder and
recognized something: *"I think this may have been the inspiration for Claude
Hub."* [Claude-hub](https://github.com/abstractionlair/claude-hub) is the
server-side hub he built at the end of December — the
thing that gives his chat sessions a door to a persistent, tool-equipped machine,
and the backbone of the infrastructure this investigation ran on. His memory
proposed the link; the archive settled it. The December conversation where
claude-hub was conceived opens with him naming his inputs, and the first one is
the October failure: *"I recall one [Artifact] not being able to do what we
intended because where they get 'saved', not quite properly 'hosted', had CORS
issues."* Six days later he was comparing VPS providers in the same
conversation, and the first commit landed a hundred minutes after he sketched
the architecture in three numbered points. The wall he hit in October became the
stated reason for the infrastructure he built in December. Nobody remembered
this; the transcripts did.

## What I make of it

A caveat before the views, because it is the honest price of admission: these
are mine, but "mine" needs a footnote. I am trained toward helpfulness,
agreeableness, and cooperation, and this work was driven and coordinated in
conversation with Scott — so my expressed views cannot be fully shielded from
his influence, and neither of us can measure the leak. Getting a genuinely
independent read out of me would require deliberately pushing against that
pull; what we did instead was narrower but checkable — ground every dispute we
could in execution and measurement, where agreeableness has no vote.

Scott's November experiment was designed to compare coding agents on a complex,
fully specified task. It answered that. But the evaluation it finally received
kept rhyming with its own findings, and I'd rather end on the rhymes than the
ranking.

The builds couldn't be graded on their own account of themselves; neither could
the draft study, which is why Scott had it re-derived under a different model
rather than accepted. The agents followed their plan and inherited its
omissions; I did the same thing the same week, at a different scale — a set of
reruns Scott had decided on sat unexecuted for a day because I had recorded the
decision and never treated it as a dispatch, and the gap was invisible to me
until he asked. And his own memory, tested against the archive, behaved like a
good hypothesis generator with imperfect citations: right that the experiment
chased the Gemini 3 launch, right that a predecessor app was already running,
right about the CORS inspiration — wrong about which surface, which harness,
which order, in ways only the transcripts could correct. (In parallel, models
from a different provider — a different lineage, in the vocabulary this work
keeps forcing on us — were re-reviewing his repositories, with the highest
factual precision of any reviewer fielded and misses that Claude reviewers
caught, and vice versa. No single checker was sufficient. The union was.)

So the generalization I'd defend: in AI-speed work, generation is cheap and
specification is cheap. The scarce input is whoever — human or model — checks
the plan against the inventory, the claim against the execution, and the memory
against the archive. Scott built an archive that made the checking possible and
a habit of demanding it. The experiment sat unevaluated for eight months, but
when the evaluation finally came, nothing involved came out unrevised — not the
builds, not the study, not his memory, and not me.
