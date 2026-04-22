#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "their",
  "they",
  "them",
  "have",
  "will",
  "about",
  "over",
  "using",
  "used",
  "role",
  "team",
  "real",
  "already",
  "would",
  "should",
  "while",
  "where",
  "what",
  "when",
  "which",
  "does",
  "across",
  "more",
  "than",
  "being",
  "been",
  "through",
  "most",
  "make",
  "made",
  "make",
  "need",
  "needs",
  "not",
  "but",
  "are",
  "our",
  "you",
  "can",
  "how",
  "why",
  "all",
  "any",
  "job",
  "work",
]);

function parseArgs(argv) {
  const options = {
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const [rawKey, inlineValue] = current.slice(2).split("=");
    const value = inlineValue ?? argv[index + 1];
    const consumesNext = inlineValue === undefined;

    switch (rawKey) {
      case "report":
        options.report = value;
        break;
      case "output":
        options.output = value;
        break;
      case "json":
        options.json = true;
        break;
      default:
        break;
    }

    if (consumesNext && rawKey !== "json") {
      index += 1;
    }
  }

  return options;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanText(value) {
  return String(value)
    .replace(/\r/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1")
    .replace(/^>\s*/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractSection(markdown, heading) {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  const target = cleanText(heading);
  const index = matches.findIndex((match) => cleanText(match[1]) === target);

  if (index === -1) {
    return "";
  }

  const start = (matches[index].index ?? 0) + matches[index][0].length;
  const end = index + 1 < matches.length ? (matches[index + 1].index ?? markdown.length) : markdown.length;
  return markdown.slice(start, end).trim();
}

function parseMarkdownTable(block) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  if (lines.length < 2) {
    return [];
  }

  const header = lines[0]
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cleanText(cell));

  return lines
    .slice(2)
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cleanText(cell)),
    )
    .filter((row) => row.length >= header.length)
    .map((row) =>
      header.reduce((record, key, index) => {
        record[key] = row[index] ?? "";
        return record;
      }, {}),
    );
}

function summarizeParagraphs(section) {
  return section
    .split(/\n\s*\n/)
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean);
}

function parseHeader(markdown, reportPath = "") {
  const titleMatch = /^#\s+Evaluation:\s+(.+?)\s+[—-]\s+(.+)$/m.exec(markdown);
  const fileName = basename(reportPath, ".md");
  const slugFallback = fileName.replace(/^\d+[-_]?/, "");
  const companyFallback = slugFallback
    .split("-")
    .slice(0, 3)
    .join(" ")
    .trim();

  const company =
    titleMatch?.[1]?.trim() ||
    companyFallback ||
    "Unknown Company";
  const role =
    titleMatch?.[2]?.trim() ||
    cleanText(extractMetadataValue(markdown, "Role")) ||
    "Unknown Role";

  return {
    company,
    role,
    date: /^\*\*Date:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "",
    archetype: /^\*\*Archetype:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "",
    score: /^\*\*Score:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "",
    url: /^\*\*URL:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "",
    legitimacy: /^\*\*Legitimacy:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "",
  };
}

function extractMetadataValue(markdown, label) {
  const expression = new RegExp(
    `^\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\*\\*\\s*(.+)$`,
    "im",
  );
  return expression.exec(markdown)?.[1]?.trim() ?? "";
}

function parseRoleSummary(section) {
  const rows = parseMarkdownTable(section);
  const fields = rows.reduce((record, row) => {
    if (row.Field) {
      record[row.Field] = row.Value ?? "";
    }
    return record;
  }, {});

  const tlDrMatch = /^\|\s*TL;DR\s*\|\s*(.+?)\s*\|$/im.exec(section);
  const remoteMatch = /^\|\s*Remote\s*\|\s*(.+?)\s*\|$/im.exec(section);
  const seniorityMatch = /^\|\s*Seniority\s*\|\s*(.+?)\s*\|$/im.exec(section);
  const functionMatch = /^\|\s*Function\s*\|\s*(.+?)\s*\|$/im.exec(section);
  const domainMatch = /^\|\s*Domain\s*\|\s*(.+?)\s*\|$/im.exec(section);
  const compMatch = /^\|\s*Comp\s*\|\s*(.+?)\s*\|$/im.exec(section);
  const durationMatch = /^\|\s*Duration\s*\|\s*(.+?)\s*\|$/im.exec(section);
  const hiringForMatch = /\*\*What they're actually hiring for:\*\*\s*([\s\S]+)$/im.exec(section);
  const hiringForParagraphs = summarizeParagraphs(hiringForMatch?.[1] ?? "").filter(
    (paragraph) => !paragraph.startsWith("|"),
  );

  return {
    fields,
    hiringFor: cleanText(hiringForParagraphs[0] ?? ""),
    tlDr: cleanText(fields["TL;DR"] ?? tlDrMatch?.[1] ?? ""),
    remote: cleanText(fields.Remote ?? remoteMatch?.[1] ?? ""),
    seniority: cleanText(fields.Seniority ?? seniorityMatch?.[1] ?? ""),
    function: cleanText(fields.Function ?? functionMatch?.[1] ?? ""),
    domain: cleanText(fields.Domain ?? domainMatch?.[1] ?? ""),
    comp: cleanText(fields.Comp ?? compMatch?.[1] ?? ""),
    duration: cleanText(fields.Duration ?? durationMatch?.[1] ?? ""),
  };
}

function parseMatchSection(section) {
  const [mainPart, gapPart = ""] = section.split(/^###\s+Gaps and Mitigation$/im);
  return {
    matchRows: parseMarkdownTable(mainPart).filter((row) => row["JD Requirement"]),
    gapRows: parseMarkdownTable(gapPart).filter((row) => row.Gap),
  };
}

function parseCv(markdown) {
  const summary =
    /##\s+Professional Summary\s+([\s\S]*?)(?=^##\s+)/im.exec(markdown)?.[1]?.trim() ?? "";
  const workSection =
    /##\s+Work Experience\s+([\s\S]*?)(?=^##\s+Projects)/im.exec(markdown)?.[1]?.trim() ?? "";
  const projectsSection =
    /##\s+Projects\s+([\s\S]*?)(?=^##\s+Education)/im.exec(markdown)?.[1]?.trim() ?? "";

  const workEntries = workSection
    .split(/^###\s+/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = normalizeLines(block);
      const company = cleanText(lines[0] ?? "");
      const role = cleanText(lines[1]?.replace(/\*\*/g, "") ?? "");
      const bullets = lines.filter((line) => line.startsWith("- ")).map((line) => cleanText(line));
      return {
        company,
        role,
        bullets,
      };
    });

  const projects = projectsSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const match = /^\-\s+\*\*(.+?)\*\*\s+--\s+(.+)$/.exec(line);
      return {
        title: cleanText(match?.[1] ?? line),
        description: cleanText(match?.[2] ?? line),
      };
    });

  return {
    summary: cleanText(summary),
    workEntries,
    projects,
  };
}

function parseProfile(markdown) {
  const primaryRoles = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => cleanText(line.replace(/^- /, "")))
    .slice(0, 4);

  return {
    headline: /headline:\s*"(.+?)"/i.exec(markdown)?.[1]?.trim() ?? "",
    exitStory: /exit_story:\s*"(.+?)"/i.exec(markdown)?.[1]?.trim() ?? "",
    compTarget: /target_range:\s*"(.+?)"/i.exec(markdown)?.[1]?.trim() ?? "",
    compMinimum: /minimum:\s*"(.+?)"/i.exec(markdown)?.[1]?.trim() ?? "",
    primaryRoles,
  };
}

function parseStoryBank(markdown) {
  return markdown
    .split(/^###\s+/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = normalizeLines(block);
      const title = cleanText(lines[0] ?? "");
      const sourceLine = lines.find((line) => line.startsWith("**Source:**"));
      const reflectionLine = lines.find((line) => line.startsWith("**Reflection:**"));
      const bestForLine = lines.find((line) => line.startsWith("**Best for questions about:**"));

      return {
        title,
        source: cleanText(sourceLine?.replace("**Source:**", "") ?? ""),
        reflection: cleanText(reflectionLine?.replace("**Reflection:**", "") ?? ""),
        bestFor: cleanText(bestForLine?.replace("**Best for questions about:**", "") ?? ""),
      };
    })
    .filter(
      (story) =>
        story.title &&
        !story.title.includes("[Theme]") &&
        !story.title.toLowerCase().includes("story title"),
    );
}

function scoreTokenOverlap(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.length || !rightTokens.length) return 0;

  const rightSet = new Set(rightTokens);
  return leftTokens.reduce((sum, token) => sum + (rightSet.has(token) ? 1 : 0), 0);
}

function pickCvAnchor({ requirement, evidence, cv }) {
  const evidenceText = `${requirement} ${evidence}`;

  const projectMatches = cv.projects.map((project) => ({
    kind: "project",
    title: project.title,
    description: project.description,
    score: scoreTokenOverlap(evidenceText, `${project.title} ${project.description}`),
  }));

  const workMatches = cv.workEntries.map((entry) => ({
    kind: "experience",
    title: `${entry.company}${entry.role ? ` — ${entry.role}` : ""}`,
    description: entry.bullets.join(" "),
    score: scoreTokenOverlap(evidenceText, `${entry.company} ${entry.role} ${entry.bullets.join(" ")}`),
  }));

  return [...projectMatches, ...workMatches]
    .sort((left, right) => right.score - left.score)[0];
}

function pickStoryMappings({ stories, interviewRows, matchRows, cv }) {
  const sourceRows = interviewRows.length
    ? interviewRows
    : matchRows.slice(0, 6).map((row) => ({
        "JD Requirement": row["JD Requirement"],
        "Story (STAR+R)": "",
        Reflection: "",
        Evidence: row.Evidence ?? row["CV Match"] ?? "",
      }));

  return sourceRows.map((row, index) => {
    const requirement = row["JD Requirement"] || "Role signal";
    const evidence = row.Evidence || "";
    const target = `${requirement} ${evidence} ${row["Story (STAR+R)"] || ""} ${row.Reflection || ""}`;

    const rankedStories = stories
      .map((story) => ({
        ...story,
        score: scoreTokenOverlap(target, `${story.title} ${story.bestFor} ${story.reflection}`),
      }))
      .sort((left, right) => right.score - left.score);

    const bestStory = rankedStories[0];
    const fit = bestStory?.score >= 3 ? "strong" : bestStory?.score > 0 ? "partial" : "none";
    const cvAnchor = pickCvAnchor({ requirement, evidence, cv });
    const evaluationStory = cleanText(row["Story (STAR+R)"] || "");
    const hasEvaluationStory = Boolean(evaluationStory);

    return {
      index: index + 1,
      topic: requirement,
      bestStoryTitle:
        fit === "none"
          ? evaluationStory || cvAnchor?.title || "Draft a fresh STAR story from this requirement"
          : bestStory.title,
      source:
        fit === "none"
          ? hasEvaluationStory
            ? "evaluation report"
            : cvAnchor?.kind === "experience"
              ? "cv.md work experience"
              : "cv.md projects"
          : bestStory.source || "story-bank.md",
      sourceType:
        fit === "none"
          ? hasEvaluationStory
            ? "evaluation"
            : "cv"
          : "story-bank",
      fit: fit === "none" && hasEvaluationStory ? "partial" : fit,
      gap: fit === "none" ? "yes" : "no",
      nextMove:
        fit === "none"
          ? hasEvaluationStory
            ? `Promote ${evaluationStory} into story-bank.md so it becomes reusable across interviews.`
            : `Draft a reusable STAR story around ${cvAnchor?.title || requirement}.`
          : fit === "partial"
            ? `Tighten the framing so ${bestStory.title} lands directly on ${requirement}.`
            : `Lead with ${bestStory.title} if this theme comes up.`,
    };
  });
}

function toBehaviorPrompt(requirement) {
  const lower = cleanText(requirement).toLowerCase();

  if (!lower) return "handle an ambiguous problem";
  if (lower.includes("ai integration")) return "integrate AI into a workflow";
  if (lower.startsWith("create ")) return lower;
  if (lower.startsWith("connect ")) return lower;
  if (lower.startsWith("make ")) return lower;
  if (lower.startsWith("eliminate ")) return lower;
  if (lower.startsWith("reduce ")) return lower;
  return `handle ${lower}`;
}

function buildStrategicReadout({ roleSummary, strategyParagraphs, compRows, profile }) {
  const bullets = [
    roleSummary.hiringFor,
    ...strategyParagraphs,
  ].map((paragraph) => cleanText(paragraph)).filter(Boolean);

  const candidateRange = profile.compTarget ? `${profile.compTarget}K ${profile.compMinimum ? `(minimum ${profile.compMinimum}K)` : ""}` : "";
  const contractSignal = compRows.find((row) => row.Metric === "Actual contract total")?.Value ?? "";

  if (candidateRange || contractSignal) {
    bullets.push(
      cleanText(
        `Comp trade-off: the role appears to be a portfolio/experience play relative to the candidate target range ${candidateRange || "on file"}${contractSignal ? `, with estimated contract economics of ${contractSignal}` : ""}.`,
      ),
    );
  }

  return unique(bullets).slice(0, 6);
}

function buildInferredRounds({ roleSummary, gapRows, interviewRows }) {
  const rounds = [
    {
      title: "Recruiter or hiring-manager screen [inferred from evaluation]",
      duration: "20-30 min",
      evaluate: `Mission alignment, availability for ${roleSummary.remote || "the stated work mode"}, and whether you understand the practical problem behind ${roleSummary.tlDr || "the role"}.`,
      prepare: 'Open by translating your strongest project into their "coordination tax" problem, not by reciting generic AI buzzwords.',
    },
    {
      title: "Practical technical walkthrough [inferred from evaluation]",
      duration: "45-60 min",
      evaluate: `How you would connect data sources, automate reporting, and make outputs usable for non-technical staff across ${gapRows.map((gap) => gap.Gap).filter(Boolean).slice(0, 3).join(", ") || "their stack"}.`,
      prepare: "Be ready to walk one end-to-end build from data ingest to user-facing output, including guardrails and trade-offs.",
    },
    {
      title: "Team or stakeholder collaboration round [inferred from evaluation]",
      duration: "30-45 min",
      evaluate: "Communication with non-technical partners, prioritization under ambiguity, and how you handle gaps in tool familiarity without becoming defensive.",
      prepare: "Use support, documentation, and dashboard stories to prove you can translate technical work for operational teams.",
    },
  ];

  if (interviewRows.length >= 4) {
    rounds.push({
      title: "Case or work-sample discussion [inferred from evaluation]",
      duration: "30-45 min",
      evaluate: 'The posting emphasizes "work samples prioritized over credentials," so expect scrutiny of repo choices, scope, and practical impact.',
      prepare: "Keep one repo openable in your head: architecture, trade-offs, bugs, what changed after feedback, and what you would improve next.",
    });
  }

  return rounds;
}

function buildQuestionGroups({ matchRows, gapRows, interviewRows, roleSummary, cv, profile }) {
  const technical = matchRows.slice(0, 5).map((row) => ({
    question: `Walk me through how you have used ${row["JD Requirement"]} to solve a real operational problem. [inferred from evaluation]`,
    why: `${row["JD Requirement"]} is explicitly called out in the report match table.`,
    bestAngle: cleanText(row.Evidence || pickCvAnchor({ requirement: row["JD Requirement"], evidence: row.Evidence, cv })?.title || "Lead with the strongest project proof point you have."),
  }));

  const behavioral = interviewRows.slice(0, 4).map((row) => ({
    question: `Tell me about a time you had to ${toBehaviorPrompt(row["JD Requirement"] || "solve an ambiguous operational problem")}. [inferred from evaluation]`,
    why: "The interview-prep section already maps this requirement to a reusable STAR story.",
    bestAngle: cleanText(`${row["Story (STAR+R)"] || "Use your strongest STAR example."}${row.Reflection ? ` — reflection: ${row.Reflection}` : ""}`),
  }));

  const roleSpecific = [
    {
      question: `How would you reduce the manual coordination overhead described in this role during your first 30 to 60 days? [inferred from evaluation]`,
      why: cleanText(roleSummary.hiringFor || roleSummary.tlDr || "This appears to be the central operating problem for the role."),
      bestAngle: "Frame your answer around data visibility, lightweight automation, and outputs that non-technical teammates can trust.",
    },
    ...gapRows.slice(0, 3).map((row) => ({
      question: `You have not used ${row.Gap} directly. How would you ramp quickly without slowing the team down? [inferred from evaluation]`,
      why: `${row.Gap} is listed as a gap in the evaluation, so they may probe learnability and risk.`,
      bestAngle: cleanText(row.Mitigation || "Acknowledge the gap plainly, then connect it to adjacent tools you already use."),
    })),
  ];

  const background = unique([
    'Your formal work history is not a traditional engineering path. Why should we trust your projects? [inferred from evaluation]',
    roleSummary.remote
      ? `Are you genuinely available for the stated ${roleSummary.remote} setup and ${roleSummary.duration || "the contract timeline"}? [inferred from evaluation]`
      : "",
    profile.compTarget
      ? `This role appears below your stated compensation target. Why is it still worth considering for you? [inferred from evaluation]`
      : "",
  ])
    .filter(Boolean)
    .map((question) => ({
      question,
      why: "This question follows from the gap between candidate context and the specifics of the posting.",
      bestAngle:
        question.includes("traditional engineering path")
          ? "Lead with shipped proof, repos, and the fact that your technical output is easier to verify than titles."
          : question.includes("compensation target")
            ? "Answer honestly: frame it as a deliberate trade-off for scope, mission, or proof-building rather than pretending comp does not matter."
            : "Answer directly and concretely; avoid vague reassurance.",
    }));

  return {
    technical: uniqueByQuestion(technical).slice(0, 6),
    behavioral: uniqueByQuestion(behavioral).slice(0, 5),
    roleSpecific: uniqueByQuestion(roleSpecific).slice(0, 5),
    background: uniqueByQuestion(background).slice(0, 4),
  };
}

function uniqueByQuestion(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.question || seen.has(item.question)) return false;
    seen.add(item.question);
    return true;
  });
}

function buildChecklist({ matchRows, gapRows, interviewRows, roleSummary }) {
  const items = [
    ...matchRows.slice(0, 5).map((row) => ({
      label: `Refresh one concrete example for ${row["JD Requirement"]}.`,
      why: cleanText(row.Evidence || `${row["JD Requirement"]} is explicitly tested by the role.`),
    })),
    ...gapRows.slice(0, 4).flatMap((row) => {
      const entries = [
        {
          label: `Prepare a calm ramp-up answer for ${row.Gap}.`,
          why: `${row.Gap} is a flagged gap and could become a trust check.`,
        },
      ];
      if (row.Mitigation) {
        entries.push({
          label: `Memorize the mitigation line for ${row.Gap}.`,
          why: cleanText(row.Mitigation),
        });
      }
      return entries;
    }),
    ...(interviewRows.length
      ? [
          {
            label: "Rehearse the lead case study aloud in two versions: 60 seconds and 3 minutes.",
            why: "The evaluation already identifies a primary story; practice it at different depths.",
          },
        ]
      : []),
    {
      label: "Prepare a concise explanation of why this role fits right now.",
      why: cleanText(roleSummary.hiringFor || roleSummary.tlDr || "The motivation answer should feel deliberate, not generic."),
    },
  ];

  return items.slice(0, 10);
}

function buildVocabulary({ reportMarkdown, roleSummary }) {
  const quotedPhrases = [...reportMarkdown.matchAll(/"([^"]+)"/g)]
    .map((match) => cleanText(match[1]))
    .filter((phrase) => phrase.length >= 8 && phrase.length <= 60);

  const explicit = [
    roleSummary.archetype,
    roleSummary.function,
    roleSummary.domain,
    "coordination tax",
    "work samples prioritized over credentials",
    "natural-language queries over structured data",
    "non-technical staff",
    "automated reporting",
  ];

  return unique([...explicit, ...quotedPhrases]).filter(Boolean).slice(0, 8);
}

function buildSignals({ roleSummary, gapRows }) {
  return {
    emphasize: unique([
      cleanText(roleSummary.hiringFor),
      "Proof over pedigree: lead with shipped artifacts and measured outcomes.",
      "Usability for non-technical teammates matters as much as technical correctness here.",
      gapRows.length ? "Learnability is part of the interview: show how you close tool gaps fast." : "",
    ]).filter(Boolean),
    avoid: [
      "Do not pitch this as a pure AI/ML research role if the report says the actual work is dashboards, integrations, and automation.",
      "Do not bluff direct experience with tools like Salesforce or Looker Studio if the evaluation flags them as gaps.",
      "Do not get defensive about non-traditional work history; redirect to repo quality, architecture choices, and operational impact.",
    ],
  };
}

function buildQuestionsToAsk({ roleSummary, gapRows }) {
  const toolList = gapRows.map((row) => row.Gap).filter(Boolean).slice(0, 3).join(", ");

  return unique([
    `What would a genuinely strong first automation win look like in the first 60 days for this ${roleSummary.function || "role"}? [inferred from evaluation]`,
    `Which parts of the current workflow create the most coordination overhead for staff today? [inferred from evaluation]`,
    toolList
      ? `Which of ${toolList} are hard requirements on day one, and which are reasonable ramp-up areas for the new hire? [inferred from evaluation]`
      : "",
  ]).filter(Boolean);
}

function formatQuestionSection(title, items) {
  const lines = [`### ${title}`];

  if (!items.length) {
    lines.push("- No strong prompts could be derived for this category yet.");
    lines.push("");
    return lines;
  }

  for (const item of items) {
    lines.push(`- **Question:** ${item.question}`);
    lines.push(`  **Why this is likely:** ${item.why}`);
    lines.push(`  **Best angle for you:** ${item.bestAngle}`);
  }

  lines.push("");
  return lines;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.report) {
    console.error(
      "Usage: node interview-intel-draft.mjs --report reports/<report>.md [--output interview-prep/<file>.md] [--json]",
    );
    process.exit(1);
  }

  const reportPath = join(projectRoot, options.report);
  if (!existsSync(reportPath)) {
    throw new Error(`Report not found: ${options.report}`);
  }

  const reportMarkdown = await readFile(reportPath, "utf8");
  const header = parseHeader(reportMarkdown, options.report);
  const roleSummarySection = extractSection(reportMarkdown, "A) Role Summary");
  const matchSection = extractSection(reportMarkdown, "B) Match with CV");
  const strategySection = extractSection(reportMarkdown, "C) Level and Strategy");
  const compSection = extractSection(reportMarkdown, "D) Comp and Demand");
  const interviewSection = extractSection(reportMarkdown, "F) Interview Prep");
  const keywordsSection = extractSection(reportMarkdown, "Keywords (ATS)");

  const roleSummary = parseRoleSummary(roleSummarySection);
  roleSummary.archetype = header.archetype;
  const { matchRows, gapRows } = parseMatchSection(matchSection);
  const interviewRows = parseMarkdownTable(interviewSection).filter((row) => row["JD Requirement"]);
  const compRows = parseMarkdownTable(compSection).filter((row) => row.Metric);
  const keywords = keywordsSection
    .split(",")
    .map((keyword) => cleanText(keyword))
    .filter(Boolean);

  const cvPath = join(projectRoot, "cv.md");
  const cv = parseCv(existsSync(cvPath) ? await readFile(cvPath, "utf8") : "");
  const profilePath = join(projectRoot, "config", "profile.yml");
  const profile = parseProfile(existsSync(profilePath) ? await readFile(profilePath, "utf8") : "");
  const storyBankPath = join(projectRoot, "interview-prep", "story-bank.md");
  const storyBankMarkdown = existsSync(storyBankPath)
    ? await readFile(storyBankPath, "utf8")
    : "";
  const storyBankStories = parseStoryBank(storyBankMarkdown);

  const storyMappings = pickStoryMappings({
    stories: storyBankStories,
    interviewRows,
    matchRows,
    cv,
  });
  const storyBankMatchCount = storyMappings.filter((item) => item.sourceType === "story-bank").length;
  const evaluationFallbackCount = storyMappings.filter((item) => item.sourceType === "evaluation").length;
  const questionGroups = buildQuestionGroups({
    matchRows,
    gapRows,
    interviewRows,
    roleSummary,
    cv,
    profile,
  });
  const checklist = buildChecklist({
    matchRows,
    gapRows,
    interviewRows,
    roleSummary,
  });
  const rounds = buildInferredRounds({
    roleSummary,
    gapRows,
    interviewRows,
  });
  const strategicReadout = buildStrategicReadout({
    roleSummary,
    strategyParagraphs: summarizeParagraphs(strategySection),
    compRows,
    profile,
  });
  const vocabulary = buildVocabulary({ reportMarkdown, roleSummary });
  const signals = buildSignals({ roleSummary, gapRows });
  const askThem = buildQuestionsToAsk({ roleSummary, gapRows });
  const reportSlug = `${slugify(header.company)}-${slugify(header.role)}`;
  const outputRelativePath = options.output || `interview-prep/${reportSlug}.md`;
  const outputPath = join(projectRoot, outputRelativePath);

  const likelyQuestionCount =
    questionGroups.technical.length +
    questionGroups.behavioral.length +
    questionGroups.roleSpecific.length +
    questionGroups.background.length;

  const lines = [
    `# Interview Intel: ${header.company} — ${header.role}`,
    "",
    `**Report:** ${options.report}`,
    `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
    `**Source URL:** ${header.url || "N/A"}`,
    `**Score / legitimacy:** ${header.score || "Unknown"}${header.legitimacy ? ` · ${header.legitimacy}` : ""}`,
    `**Method:** Derived from the existing evaluation report, cv.md, config/profile.yml, and story bank. Any question marked \`[inferred from evaluation]\` is reasoned from local material, not sourced from external candidate reports.`,
    "",
    "## Process Overview",
    `- **Archetype:** ${header.archetype || "Unknown"}`,
    `- **Role shape:** ${roleSummary.tlDr || "See the evaluation report for the role summary."}`,
    `- **Core hiring problem:** ${roleSummary.hiringFor || "The evaluation did not capture a separate hiring-problem summary."}`,
    `- **Role logistics:** ${[roleSummary.remote, roleSummary.duration, roleSummary.comp].filter(Boolean).join(" · ") || "See report."}`,
    `- **Candidate context:** ${profile.headline || cv.summary || "Candidate context unavailable."}`,
    `- **Current prep assets:** ${interviewRows.length} interview-map row(s), ${storyBankMatchCount} story-bank match(es), ${evaluationFallbackCount} evaluation-story fallback(s), ${keywords.length} tracked keyword(s)`,
    `- **Research depth:** Internal sources only — this draft has not run live external interview research.`,
    "",
    "## Strategic Readout",
    ...strategicReadout.map((paragraph) => `- ${paragraph}`),
    "",
    "## Expected Interview Shape",
    ...rounds.flatMap((round, index) => [
      `### Round ${index + 1}: ${round.title}`,
      `- **Estimated duration:** ${round.duration}`,
      `- **What they are likely testing:** ${round.evaluate}`,
      `- **How to prepare:** ${round.prepare}`,
      "",
    ]),
    "## Likely Questions",
    ...formatQuestionSection("Technical", questionGroups.technical),
    ...formatQuestionSection("Behavioral", questionGroups.behavioral),
    ...formatQuestionSection("Role-Specific", questionGroups.roleSpecific),
    ...formatQuestionSection("Background Red Flags", questionGroups.background),
    "## Story Bank Mapping",
    "| # | Likely question/topic | Best story | Fit | Gap? | Next move |",
    "|---|----------------------|------------|-----|------|-----------|",
    ...storyMappings.map(
      (item) =>
        `| ${item.index} | ${item.topic} | ${item.bestStoryTitle} | ${item.fit} | ${item.gap} | ${item.nextMove} |`,
    ),
    "",
    "## Evaluation Story Map",
    "| # | Requirement | Story | Best angle |",
    "|---|-------------|-------|------------|",
    ...(
      interviewRows.length
        ? interviewRows.map(
            (row, index) =>
              `| ${index + 1} | ${row["JD Requirement"] || "Signal"} | ${row["Story (STAR+R)"] || "Needs drafting"} | ${row.Reflection || row.R || "Use the result and reflection to close strongly"} |`,
          )
        : ["| 1 | No structured interview rows found | Draft one story from the strongest matched project | Lead with impact, trade-offs, and what changed because of your work |"]
    ),
    "",
    "## Background Framing",
    ...questionGroups.background.map((item) => `- **Likely concern:** ${item.question}\n  **Recommended framing:** ${item.bestAngle}`),
    "",
    "## Technical Prep Checklist",
    ...checklist.map((item) => `- [ ] ${item.label} — why: ${item.why}`),
    "",
    "## Company Signals",
    `- **Vocabulary to mirror:** ${vocabulary.join(", ") || "Use the language already present in the posting and evaluation."}`,
    ...signals.emphasize.map((item) => `- **Emphasize:** ${item}`),
    ...signals.avoid.map((item) => `- **Avoid:** ${item}`),
    "",
    "## Questions To Ask Them",
    ...askThem.map((question) => `- ${question}`),
    "",
  ];

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          company: header.company,
          role: header.role,
          outputPath: outputRelativePath,
          reportPath: options.report,
          storyMatches: storyBankMatchCount,
          inferredQuestions: likelyQuestionCount,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Interview intel generated: ${outputRelativePath}`);
  console.log(`Company: ${header.company}`);
  console.log(`Role: ${header.role}`);
  console.log(`Story matches: ${storyBankMatchCount}`);
}

main().catch((error) => {
  console.error("interview-intel-draft.mjs failed:", error.message);
  process.exit(1);
});
