# Email to Tested App in Under Ten Hours

*A faculty brainstorm tool, three collaborators, and the new shape of custom software.*

---

On the morning of April 20, my colleague Willie emailed me a transcript of a long conversation he'd had with Claude about the ethics of AI in warfare. He'd found it unexpectedly good and thought it could seed an exercise for our first-year business sequence. He wanted to brainstorm it with four or five other faculty, ideally asynchronously, ideally soon.

Under ten hours later, **MindForum** was live on my VPS, preloaded with his transcript and a draft of a student-facing AI prompt, with a facilitator AI waiting in the chat. I had already sent the first `@ai help me get started`, found the reply thin, tuned the system prompt, and spun the room back up.

No part of this story is about AI writing code faster than humans. It's about what happens to the *shape of software* when building becomes cheap enough that you can make a tool that fits one specific group's one specific problem.

## The collaboration chain

The speed didn't come from one person moving fast. It came from three people each doing the part they were best at, and handing off cleanly.

**[Ash](https://github.com/ashcastelinocs124)** — an MSBA student at Gies — wrote the spec. After a few Teams messages that morning, he came back with two careful design documents: a data model and a task-by-task implementation plan. Rooms in memory, SSE for live updates, PDF/DOCX parsing, a "Generate project brief" button using structured JSON output. Not a wishlist — runnable instructions.

**I executed from his spec.** Cloned his repo, worked through the 18-task plan with Claude Opus 4.7 over a few hours, adapted a few things (moved the model to `gpt-5.4`, instantiated the OpenAI client per-request to avoid Vercel-style build-phase failures), kept most of Ash's architecture intact. Pushed to GitHub.

**Ash polished the UI.** He pulled my commit and added an orange pill badge highlighting `@ai` mentions in the composer, so users see the trigger activate before sending. A small change that makes the interaction obvious — exactly the sort of thing I would never have prioritized.

**I handled the deploy.** Almost none of which was new work. My VPS was already running five other apps; my reverse proxy already had a pattern for pointing new subdomains at internal ports; previous deploys had all the gotchas documented — catch-all worker, nginx streaming settings, systemd unit. An existing app on the same box had a working OpenAI key in its `.env`; I reused it. The only genuinely new thing was a per-repo deploy key on GitHub. Total deploy time: 45 minutes, spread across an afternoon. This is the point I made in [my last newsletter](https://chatwithgpt.substack.com/p/build-it-and-they-will-learn) — you build the first custom tool the slow way, and every subsequent one lands on infrastructure you've already paid for.

Three people, clear roles, under ten hours of wall-clock time from email to tested app. Nobody worked through the night. Nobody held a meeting.

## What the app actually is

[MindForum](https://github.com/gies-ai-experiments/MindForum) is 1,000 lines of TypeScript across a Next.js 15 app with one purpose: let a small group chat together with an AI that only speaks when mentioned. Someone creates a room, pastes a system prompt, invites others with a link. Anyone can upload documents. `@ai` pulls the AI into the conversation; everyone sees its reply. One button turns the conversation into a structured brief (themes, outline, risks, next steps, suggested collaborators) that exports as clean markdown.

The features it *doesn't* have are the point:

- **No authentication.** The room link is the gate. Anyone with it joins with a name and email — no signup, no verification, no invitation flow.
- **A database arrived late.** The MVP used one Node process's memory and was fine for the first few rooms. When it became clear a second use case was coming — and restarts would lose real data — I added Postgres in an afternoon. Four tables, one migration script, no schema gymnastics. The point isn't "start with no database"; the point is start with *the simplest persistence that matches today's use* and add weight only when a use case earns it.
- **No roles, moderation, permissions, analytics, or feature flags.** Faculty peers don't need a hierarchy. None of the rest is needed either.
- **No generic AI chat.** The bot stays silent until mentioned. Plain messages are for humans talking to humans.

What it *does* have, it handles carefully:

- **Streaming replies.** Tokens stream in as they're generated, so users see the AI thinking rather than staring at dead air.
- **Per-room system prompt.** Every room has its own AI guidance, set at creation and visible as a collapsible card so joiners see how the facilitator was configured.
- **Document grounding.** Uploads are parsed server-side and injected into the AI's context when selected.

[When software gets this cheap to build](https://chatwithgpt.substack.com/p/the-magnitude-9-earthquake-how-ai), you stop designing for scale you don't have and start designing for the exact shape of the problem in front of you.

## What the prototype made visible

Here's the part I didn't expect.

I asked Willie to write a system prompt for the room. I had drafted one of my own. I expected a minor editing exercise where we'd merge the two.

His didn't look like mine at all. Mine was facilitation — probe, pressure-test, ask one question at a time. His was a 600-word manifesto on epistemic integrity: *hold position under pressure, name sycophancy when it happens, don't update because the user seems frustrated*.

Over email we would've had a low-stakes disagreement and lost a week. With the app between us, the ambiguity was suddenly concrete: I pasted his prompt in and saw what the AI would do if it ran the brainstorm. It wouldn't facilitate at all. It would argue.

The resolution: **we were talking about two different AIs.** My prompt governs the brainstorm room — a workflow tool. Willie's is a draft of the *student-facing* AI the exercise produces — the one students will eventually talk to. Different AIs, different jobs, and the deliverable is now explicitly two artifacts: a scenario and a student-facing prompt.

I don't think we would have converged on that framing by writing more documents. Requirements docs let people talk past each other indefinitely because the words look like agreement. The app, because it had to *do something* with both prompts, forced the distinction into the open within an hour.

## The low-friction shape

Look at what the feature set implies about who this is for.

No auth means: *trusted small groups sharing a private link*. A four-table Postgres schema with no migrations framework means: *durable enough for a semester, not built for ten years*. Per-room system prompts mean: *every room has a specific purpose the creator has thought about*. Document upload with automatic AI grounding means: *the work starts from real material, not a blank page*.

You can't buy a tool that makes those tradeoffs. A commercial group-chat-with-AI platform has to solve for auth, multi-tenancy, billing, compliance, moderation. Those features aren't wrong; they're tuned for a different audience. A tool for five colleagues over three days is a different object than a tool for a 50,000-person organization.

This is what people are starting to call **Personal Software** — software built to fit one person or one small group, not amortized over a million users. The term isn't mine; Geoffrey Litt and Ink & Switch have been sketching it for a while. What's changed is the economics. Until recently, building custom for a transient five-person need cost more than the need was worth, so you got software designed for someone else. Now it costs about the same as scheduling the kickoff meeting. The default stops being "find a SaaS that's close enough" and starts being "what exactly do we need for this week."

A few more MindForum rooms are coming over the next few weeks: a grant proposal, a curriculum redesign, a faculty search committee reading candidate files. Some will die when they're done. A few will persist because the conversation itself is the artifact — what fifteen students said about a course, what four faculty decided after arguing through a draft. That's what pushed me to add Postgres yesterday: the second use case made the conversations worth keeping.

## Second room, second problem — the next day

I'd planned to let MindForum sit for a week. It sat for one afternoon.

I was teaching my undergraduate Tech & AI Strategy course — end of semester, the moment when you want honest student feedback and almost never get it. The usual instruments are bad: Canvas evaluations arrive anonymized but after grades are in; verbal feedback skews toward whoever's comfortable talking in front of peers; Google Forms get you fragments with no conversation.

I named a new room, wrote a short facilitator prompt (*"Help me gather candid feedback. Stay quiet unless mentioned with `@ai`. Cluster into themes. Be neutral — do not defend the course."*), uploaded a one-page "course at a glance" markdown file so students and the AI could both name specific weeks, and projected the join link. Total setup: under five minutes, on the podium, while the students pulled out laptops.

Eighteen joined. Over twenty-five minutes they filled the room with twenty-three messages. Not "the course was great" — specifics: *"assignments were rushed and needed more explanation."* *"The agentic workflow felt like too much. Daily notes felt like busy work."* *"I spent most of my time figuring out how to do the assignment, not actually doing it."* One student typed `@ai make a response about how assignments were rushed`, and the AI replied with a targeted follow-up: which two assignments, and what "more personalization" would mean. The student answered. A named assignment and a concrete fix surfaced in ninety seconds.

The room has a trick I hadn't planned for. Joining requires a name and email but the server doesn't verify either. A facilitator can tell students to use pseudonyms and get genuinely anonymous input in a shared space where themes still cluster visibly. My students used real names — this group trusts each other — but the optionality is there. You get *group brainstorming* dynamics without the *forced attribution* cost.

When I hit **Generate project brief** at the end, the AI produced a 2,000-word structured document: five themes, seven risks, an outline grounded in actual student quotes, a "what to keep" section, next steps. I pulled a JSON dump from the Postgres side, cross-referenced every theme against my course files and my [teaching philosophy notes](https://chatwithgpt.substack.com/p/build-it-and-they-will-learn), and by evening had a prioritized Spring 2027 change list — each change tied to a student quote and a pedagogical principle, sorted P0/P1/P2.

The tool didn't do the analysis for me. It eliminated the twenty hours I'd normally spend stitching scattered feedback together and trying to cluster themes. The clustering was already done, by the AI, in the students' own words, while the students were still in the room to react to it.

Same codebase as the faculty brainstorm tool. Different system prompt, different uploaded file, different audience. No feature added. No deploy. No meeting with IT. Zero to answer in under thirty minutes of class time.

## Faculty practicing what they'll teach

Willie's exercise is going to put freshmen in conversation with an AI configured to push back, hold positions, and refuse sycophantic agreement. The pedagogical goal is that students learn to notice the difference between honest disagreement and theatrical capitulation.

The route to designing that exercise — a custom-built tool, spun up in a day, that let three people and an AI iterate together on what the exercise should be — is itself a version of what the exercise is trying to teach. We didn't wait for IT to build something. We didn't argue about requirements. We built the thing, tested it, and the thing told us what we'd left unclear.

Business schools talk a lot about how AI is reshaping work. [One way it reshapes work](https://chatwithgpt.substack.com/p/the-classroom-where-ai-and-students) is that the people closest to the problem can now build the tool — not "prompt ChatGPT to write an essay," but actually ship working software that does the specific job, deploy it, invite real colleagues, iterate. That capability is now within reach of any faculty member willing to pair with a student, a TA, or Claude.

This is the loop I keep returning to in [my talks](https://chatwithgpt.substack.com/p/build-it-and-they-will-learn): **Learn to Build. Build to Learn.** The first half is capability — getting fluent enough with AI as a collaborator that shipping a small thing stops being intimidating. The second half is pedagogy — the act of building is how you discover what you actually believe about a problem. The halves aren't sequential; they compound. Willie and I didn't learn to build and then sit down to design the exercise — we learned what the exercise *was* by building the tool to design it. And my students gave me sharper feedback precisely because they'd spent the semester shipping their own MVPs and knew from the inside what "this instruction was unclear" actually felt like.

## What's in the repo

Everything is on GitHub at [gies-ai-experiments/MindForum](https://github.com/gies-ai-experiments/MindForum), including:

- The app code (~1,000 lines, Next.js 15 + TypeScript + SSE)
- Ash's [design doc](https://github.com/gies-ai-experiments/MindForum/blob/main/docs/plans/2026-04-20-seminar-room-design.md) and [task plan](https://github.com/gies-ai-experiments/MindForum/blob/main/docs/plans/2026-04-20-seminar-room.md) that started it
- A [`rooms/` folder](https://github.com/gies-ai-experiments/MindForum/tree/main/rooms/2026-04-20-ai-ethics-exercise-design) with the configuration for Willie's specific brainstorm: facilitator prompt, draft student-facing prompt, source transcript, setup README
- A [handoff issue](https://github.com/gies-ai-experiments/MindForum/issues/1) I opened for Ash documenting what I changed versus his spec

If you want to run your own: `git clone`, add an OpenAI key to `.env.local`, `npm install && npm run dev`. Deployment recipe (systemd + nginx with SSE-safe settings) is in the README.

None of this is novel software engineering. What's novel is that a faculty member, an MSBA student, and an AI assistant can build and deploy a custom tool in a single afternoon, have it fit one problem exactly — and then, the next day, have it fit a completely different problem that didn't exist when we built it.

Willie's faculty cohort is in the room now. The student-feedback room from yesterday is already driving the Spring 2027 syllabus. Two rooms, two audiences, two problems that would have been three weeks of work each a year ago.

The next room is the one after that.
