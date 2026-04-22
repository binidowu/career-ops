#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

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
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSection(markdown, heading) {
  const expression = new RegExp(
    `^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`,
    "im",
  );
  return expression.exec(markdown)?.[1]?.trim() ?? "";
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

function parseHeader(markdown) {
  const titleMatch = /^#\s+Evaluation:\s+(.+?)\s+[—-]\s+(.+)$/m.exec(markdown);
  const company = titleMatch?.[1]?.trim() ?? "Unknown Company";
  const role = titleMatch?.[2]?.trim() ?? "Unknown Role";

  return {
    company,
    role,
    date: /^\*\*Date:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "",
    archetype: /^\*\*Archetype:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "",
    url: /^\*\*URL:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "",
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
      const bestForLine = lines.find((line) => line.startsWith("**Best for questions about:**"));
      const sourceLine = lines.find((line) => line.startsWith("**Source:**"));
      return {
        title,
        source: cleanText(sourceLine?.replace("**Source:**", "") ?? ""),
        bestFor: cleanText(bestForLine?.replace("**Best for questions about:**", "") ?? ""),
      };
    })
    .filter((story) => story.title);
}

function pickStoryMatches(stories, requirements, keywords) {
  const targets = [...requirements, ...keywords].map((value) => value.toLowerCase());

  return stories
    .map((story) => {
      const haystack = `${story.title} ${story.bestFor} ${story.source}`.toLowerCase();
      const score = targets.reduce((sum, target) => {
        if (!target) return sum;
        return haystack.includes(target) ? sum + 1 : sum;
      }, 0);

      return { ...story, score };
    })
    .filter((story) => story.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function buildLikelyQuestions(matchRows, gapRows, keywords) {
  const technical = matchRows
    .filter((row) => row["JD Requirement"])
    .slice(0, 6)
    .map((row) => `How have you already applied ${row["JD Requirement"]} in a real project? [inferred from evaluation]`);

  const risk = gapRows
    .slice(0, 4)
    .map((row) => `You do not show direct experience with ${row.Gap}. How would you ramp quickly? [inferred from evaluation]`);

  const keywordQuestions = keywords
    .slice(0, 4)
    .map((keyword) => `What is your practical experience with ${keyword}? [inferred from evaluation]`);

  return [...technical, ...risk, ...keywordQuestions];
}

function buildChecklist(matchRows, gapRows, keywords) {
  const items = [];

  for (const row of matchRows.slice(0, 6)) {
    if (row["JD Requirement"]) {
      items.push(`Review a concise example for ${row["JD Requirement"]}.`);
    }
  }

  for (const row of gapRows.slice(0, 4)) {
    if (row.Gap) {
      items.push(`Prepare a non-defensive answer for the gap in ${row.Gap}.`);
    }
    if (row.Mitigation) {
      items.push(`Lead with this mitigation: ${row.Mitigation}`);
    }
  }

  for (const keyword of keywords.slice(0, 6)) {
    items.push(`Be ready to speak clearly about ${keyword}.`);
  }

  return [...new Set(items)].slice(0, 10);
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
  const header = parseHeader(reportMarkdown);
  const roleSummarySection = extractSection(reportMarkdown, "A) Role Summary");
  const matchSection = extractSection(reportMarkdown, "B) Match with CV");
  const strategySection = extractSection(reportMarkdown, "C) Level and Strategy");
  const interviewSection = extractSection(reportMarkdown, "F) Interview Prep");
  const keywordsSection = extractSection(reportMarkdown, "Keywords (ATS)");

  const matchRows = parseMarkdownTable(matchSection).filter((row) => row["JD Requirement"]);
  const gapRows = parseMarkdownTable(matchSection.split(/^###\s+Gaps and Mitigation$/im)[1] ?? "")
    .filter((row) => row.Gap);
  const interviewRows = parseMarkdownTable(interviewSection).filter((row) => row["JD Requirement"]);
  const keywords = keywordsSection
    .split(",")
    .map((keyword) => cleanText(keyword))
    .filter(Boolean);

  const storyBankPath = join(projectRoot, "interview-prep", "story-bank.md");
  const storyBankMarkdown = existsSync(storyBankPath)
    ? await readFile(storyBankPath, "utf8")
    : "";
  const storyBankStories = parseStoryBank(storyBankMarkdown);
  const storyMatches = pickStoryMatches(
    storyBankStories,
    matchRows.map((row) => row["JD Requirement"] ?? ""),
    keywords,
  );
  const likelyQuestions = buildLikelyQuestions(matchRows, gapRows, keywords);
  const checklist = buildChecklist(matchRows, gapRows, keywords);
  const summaryParagraphs = summarizeParagraphs(strategySection).slice(0, 3);
  const reportSlug = `${slugify(header.company)}-${slugify(header.role)}`;
  const outputRelativePath = options.output || `interview-prep/${reportSlug}.md`;
  const outputPath = join(projectRoot, outputRelativePath);

  const lines = [
    `# Interview Intel: ${header.company} — ${header.role}`,
    "",
    `**Report:** ${options.report}`,
    `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
    `**Source URL:** ${header.url || "N/A"}`,
    `**Method:** Derived from the existing evaluation report and story bank. Any question marked \`[inferred from evaluation]\` is a reasoned prompt, not a sourced candidate report.`,
    "",
    "## Process Overview",
    `- **Archetype:** ${header.archetype || "Unknown"}`,
    `- **Role summary:** ${cleanText(roleSummarySection.match(/\| TL;DR \|(.+)\|/)?.[1] ?? "See evaluation report")}`,
    `- **Current prep assets:** ${interviewRows.length} structured interview stories in the evaluation, ${storyMatches.length} relevant story-bank matches`,
    `- **Research depth:** Internal evaluation only — external company-specific sourcing has not been run by this script`,
    "",
    "## Strategic Readout",
    ...summaryParagraphs.map((paragraph) => `- ${paragraph}`),
    "",
    "## Likely Questions",
    ...likelyQuestions.map((question) => `- ${question}`),
    "",
    "## Story Bank Mapping",
    "| # | Likely topic | Best story from story-bank.md | Source |",
    "|---|--------------|-------------------------------|--------|",
    ...(
      storyMatches.length
        ? storyMatches.map((story, index) => `| ${index + 1} | ${story.bestFor || "General interview fit"} | ${story.title} | ${story.source || "story-bank"} |`)
        : ["| 1 | No existing story-bank matches | Add a reusable STAR+R story for this role after your next rehearsal | story-bank.md |"]
    ),
    "",
    "## Evaluation Story Map",
    "| # | Requirement | Story | Best angle |",
    "|---|-------------|-------|------------|",
    ...(
      interviewRows.length
        ? interviewRows.map((row, index) => `| ${index + 1} | ${row["JD Requirement"] || "Signal"} | ${row["Story (STAR+R)"] || row["STAR Story"] || "Needs drafting"} | ${row.Reflection || row.Result || "Use the result and reflection to close strongly"} |`)
        : ["| 1 | No structured interview stories in evaluation | Draft one from the strongest project example in your CV | Use the report gaps below to choose the first story to build |"]
    ),
    "",
    "## Risk Areas",
    ...(
      gapRows.length
        ? gapRows.map((row) => `- **${row.Gap}** — ${row.Mitigation || "Prepare a direct, forward-looking answer."}`)
        : ["- No explicit blockers were flagged in the evaluation report."]
    ),
    "",
    "## Technical Prep Checklist",
    ...checklist.map((item) => `- [ ] ${item}`),
    "",
    "## Questions To Ask Them",
    `- How does this role define success in the first 60 to 90 days given the current ${header.archetype || "team"} priorities? [inferred from evaluation]`,
    `- Which tools in the stack are fixed requirements versus tools you expect the hire to ramp on quickly? [inferred from evaluation]`,
    `- Where is the biggest manual coordination overhead today, and what would a strong first automation win look like? [inferred from evaluation]`,
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
          storyMatches: storyMatches.length,
          inferredQuestions: likelyQuestions.length,
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
  console.log(`Story matches: ${storyMatches.length}`);
}

main().catch((error) => {
  console.error("interview-intel-draft.mjs failed:", error.message);
  process.exit(1);
});
