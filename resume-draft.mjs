#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import yaml from "js-yaml";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

function parseArgs(argv) {
  const options = {
    format: "letter",
    json: false,
    tone: 50,
    variant: "balanced",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = current.slice(2).split("=");
    const value = inlineValue ?? argv[index + 1];
    const consumesNext = inlineValue === undefined;

    switch (rawKey) {
      case "report":
        options.report = value;
        break;
      case "resume-id":
        options.resumeId = value;
        break;
      case "resume-path":
        options.resumePath = value;
        break;
      case "format":
        options.format = value === "a4" ? "a4" : "letter";
        break;
      case "variant":
        options.variant =
          value === "technical" || value === "execution" ? value : "balanced";
        break;
      case "tone":
        options.tone = Math.max(0, Math.min(100, Number(value || 50) || 50));
        break;
      case "headline-override":
        options.headlineOverride = value || "";
        break;
      case "summary-override":
        options.summaryOverride = value || "";
        break;
      case "html-out":
        options.htmlOut = value;
        break;
      case "pdf-out":
        options.pdfOut = value;
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
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items)];
}

function tokenize(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#/.]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreText(text, keywords) {
  const haystack = text.toLowerCase();

  return keywords.reduce((score, keyword) => {
    if (!keyword) {
      return score;
    }

    if (haystack.includes(keyword.toLowerCase())) {
      return score + Math.max(1, tokenize(keyword).length);
    }

    return score;
  }, 0);
}

function cleanSentence(value) {
  return value
    .replace(/\|/g, " ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function takeLeadSentences(value, count) {
  const matches = cleanSentence(value).match(/[^.!?]+[.!?]?/g) ?? [];
  return matches
    .slice(0, count)
    .map((sentence) => sentence.trim())
    .join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function extractSection(markdown, heading) {
  const expression = new RegExp(
    `^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`,
    "im",
  );
  return expression.exec(markdown)?.[1]?.trim() ?? "";
}

function parseHeaderContact(markdown) {
  const header = markdown.split(/^##\s+/m)[0] ?? "";
  const contactEntries = [...header.matchAll(/\*\*([^*]+):\*\*\s*(.+)$/gm)];

  return contactEntries.reduce((record, match) => {
    const key = match[1]?.trim() ?? "";
    const value = match[2]?.trim() ?? "";

    if (key && value) {
      record[key] = value;
    }

    return record;
  }, {});
}

function parseExperiences(section) {
  if (!section) {
    return [];
  }

  return section
    .split(/^###\s+/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = normalizeLines(block);
      const [companyLine = "", roleLine = "", periodLine = ""] = lines;
      const bullets = lines
        .slice(3)
        .filter((line) => line.startsWith("- "))
        .map((line) => line.replace(/^- /, "").trim());
      const [company, location = ""] = companyLine.split(/\s+--\s+/);

      return {
        company: company.trim(),
        location: location.trim(),
        role: roleLine.replace(/\*\*/g, "").trim(),
        period: periodLine.trim(),
        bullets,
      };
    })
    .filter((entry) => entry.company || entry.role);
}

function parseProjects(section) {
  return normalizeLines(section)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .map((line) => {
      const match = /^\*\*(.+?)\*\*\s+--\s+(.+)$/.exec(line);

      if (match) {
        return {
          title: match[1].trim(),
          description: match[2].trim(),
        };
      }

      return { title: line, description: "" };
    });
}

function parseSkills(section) {
  return normalizeLines(section)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .map((line) => {
      const match = /^\*\*(.+?):\*\*\s+(.+)$|^\*\*(.+?)\*\*:\s+(.+)$/.exec(line);

      if (match) {
        const label = (match[1] || match[3]).trim();
        const items = (match[2] || match[4])
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

        return { label, items };
      }

      return {
        label: "General",
        items: line
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      };
    });
}

function parseEducation(section) {
  return normalizeLines(section)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());
}

function parseResumeMarkdown(markdown) {
  const heading =
    /^#\s+CV\s+--\s+(.+)$/m.exec(markdown)?.[1]?.trim() ??
    /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ??
    "Candidate";

  return {
    name: heading,
    contact: parseHeaderContact(markdown),
    summary:
      extractSection(markdown, "Professional Summary") ||
      extractSection(markdown, "Summary"),
    experiences: parseExperiences(extractSection(markdown, "Work Experience")),
    projects: parseProjects(extractSection(markdown, "Projects")),
    education: parseEducation(extractSection(markdown, "Education")),
    skills: parseSkills(extractSection(markdown, "Skills")),
  };
}

function parseReportSections(markdown) {
  const matches = [...markdown.matchAll(/^##\s+([A-Z])\s+—\s+(.+)$/gm)];

  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    return {
      key: match[1],
      heading: match[2].trim(),
      body: markdown.slice(start, end).trim(),
    };
  });
}

function extractReportKeywords(report, resume) {
  const reportText = [
    report.role,
    report.company,
    report.summary,
    ...report.sections.map((section) => section.body),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const skillCandidates = resume.skills.flatMap((group) => group.items);
  const exactMatches = skillCandidates.filter((item) =>
    reportText.includes(item.toLowerCase()),
  );

  const roleCandidates = unique([
    ...tokenize(report.role).filter((token) => token.length >= 4),
    ...(report.archetype ? tokenize(report.archetype) : []),
  ]).map((token) => token.replace(/\b\w/g, (char) => char.toUpperCase()));

  return unique([...exactMatches, ...roleCandidates]).slice(0, 8);
}

function parseReportMarkdown(markdown) {
  const titleMatch = /^#\s+Evaluation Report\s+—\s+(.+?)\s+@\s+(.+)$/m.exec(markdown);
  const sections = parseReportSections(markdown);
  const summarySection =
    sections.find((section) => section.key === "B")?.body ||
    sections.find((section) => section.key === "F")?.body ||
    "";

  const summaryParagraph = cleanSentence(
    summarySection
      .split("\n")
      .find((line) => line.trim() && !line.trim().startsWith("**")) || "",
  );

  const nextSteps = (
    sections.find((section) => section.key === "F")?.body.match(/^\d+\.\s+.+$/gm) ?? []
  ).map((line) => cleanSentence(line.replace(/^\d+\.\s+/, "")));

  return {
    role: titleMatch?.[1]?.trim() ?? "Unknown role",
    company: titleMatch?.[2]?.trim() ?? "Unknown company",
    score: /\*\*Score:\*\*\s*([0-9.]+)\/5/i.exec(markdown)?.[1] ?? null,
    url: /\*\*URL:\*\*\s*(.+)$/im.exec(markdown)?.[1]?.trim() ?? "",
    archetype: /Archetype:\s+\*\*(.+?)\*\*/i.exec(markdown)?.[1]?.trim() ?? "",
    summary: summaryParagraph,
    sections,
    nextSteps,
  };
}

function loadProfile() {
  const profilePath = join(projectRoot, "config", "profile.yml");

  if (!existsSync(profilePath)) {
    return null;
  }

  return yaml.load(readFileSync(profilePath, "utf8"));
}

function getResumeSources(profile) {
  if (!profile || !Array.isArray(profile.resume_sources)) {
    return [];
  }

  return profile.resume_sources
    .map((source) => ({
      id: String(source.id || "").trim(),
      label: String(source.label || source.id || "Resume source").trim(),
      path: String(source.path || "").trim(),
      default: Boolean(source.default),
      targetRoles: Array.isArray(source.target_roles)
        ? source.target_roles.map((entry) => String(entry).trim()).filter(Boolean)
        : [],
    }))
    .filter((source) => source.id && source.path);
}

function resolveResumeSource(profile, options) {
  const resumeSources = getResumeSources(profile);

  if (options.resumePath) {
    const path = resolve(projectRoot, options.resumePath);
    return {
      id: options.resumeId || slugify(basename(path, ".md")),
      label: options.resumeId || basename(path),
      path,
      targetRoles: [],
    };
  }

  if (resumeSources.length) {
    const source =
      (options.resumeId
        ? resumeSources.find((entry) => entry.id === options.resumeId)
        : null) ||
      resumeSources.find((entry) => entry.default) ||
      resumeSources[0];

    if (source) {
      return {
        ...source,
        path: resolve(projectRoot, source.path),
      };
    }
  }

  return {
    id: "general",
    label: "General resume",
    path: join(projectRoot, "cv.md"),
    targetRoles: [],
  };
}

function buildContactLines(profile, resume) {
  const candidate = profile?.candidate || {};
  const profileLines = [
    candidate.location,
    candidate.email,
    candidate.phone,
    candidate.linkedin,
    candidate.github,
    candidate.portfolio_url,
  ].filter((value) => Boolean(value && String(value).trim()));

  if (profileLines.length) {
    return profileLines.map((value) => String(value).trim());
  }

  return Object.values(resume.contact).filter(Boolean);
}

function buildHeadline(profile, report, variant, tone, override) {
  if (override?.trim()) {
    return override.trim();
  }

  const narrativeHeadline = profile?.narrative?.headline;
  if (narrativeHeadline && tone < 65 && variant === "balanced") {
    return String(narrativeHeadline).trim();
  }

  if (variant === "technical") {
    return tone >= 60
      ? "AI / software engineer building agentic systems, RAG pipelines, and production-ready tooling"
      : "Software engineer with hands-on experience in agentic systems, RAG pipelines, and AI product delivery";
  }

  if (variant === "execution") {
    return tone >= 60
      ? "Software engineer shipping AI-powered tools, full-stack systems, and reliable operator workflows"
      : "Software engineer translating ambiguous requirements into reliable AI-assisted systems";
  }

  return tone >= 60
    ? `${report.role} candidate with hands-on AI systems and full-stack delivery experience`
    : "Software engineer with hands-on experience building AI systems and full-stack applications";
}

function buildSummary(profile, resume, report, tone, variant, override) {
  if (override?.trim()) {
    return override.trim();
  }

  const base =
    takeLeadSentences(profile?.narrative?.exit_story || "", 2) ||
    takeLeadSentences(resume.summary, 2) ||
    "Software engineer with hands-on experience building AI systems and delivery-oriented full-stack products.";

  const reportSummary = cleanSentence(report.summary || "");
  const roleLine =
    variant === "technical"
      ? "Best used for roles that value React delivery, AI tooling familiarity, and hands-on system building."
      : variant === "execution"
        ? "Strong fit for roles that value shipping, troubleshooting, and turning ambiguous requirements into working systems."
        : `Targeting ${report.role} roles with strong overlap in frontend delivery, API integration, and AI-assisted product development.`;

  const closing =
    tone >= 60
      ? reportSummary || `Ready to contribute quickly on ${report.company} problems with strong ownership.`
      : reportSummary;

  return [base, roleLine, closing].filter(Boolean).slice(0, 3).join(" ");
}

function buildDraft({ profile, resume, report, options, source }) {
  const focusKeywords = extractReportKeywords(report, resume);
  const rankingKeywords = unique([
    ...focusKeywords,
    report.role,
    report.company,
    report.archetype,
    ...(options.variant === "technical"
      ? ["python", "typescript", "api", "rag", "agentic", "langchain", "react"]
      : []),
    ...(options.variant === "execution"
      ? ["delivery", "troubleshooting", "documentation", "workflow", "operations"]
      : []),
  ].filter(Boolean));

  const experiences = [...resume.experiences]
    .sort((left, right) => {
      const leftScore = scoreText(
        `${left.company} ${left.role} ${left.location} ${left.bullets.join(" ")}`,
        rankingKeywords,
      );
      const rightScore = scoreText(
        `${right.company} ${right.role} ${right.location} ${right.bullets.join(" ")}`,
        rankingKeywords,
      );
      return rightScore - leftScore;
    })
    .slice(0, 5)
    .map((experience) => ({
      heading: experience.company,
      subheading: [experience.role, experience.location, experience.period]
        .filter(Boolean)
        .join(" · "),
      bullets: [...experience.bullets]
        .sort(
          (left, right) =>
            scoreText(right, rankingKeywords) - scoreText(left, rankingKeywords),
        )
        .slice(0, options.variant === "technical" ? 4 : 5),
    }));

  const projects = [...resume.projects]
    .sort(
      (left, right) =>
        scoreText(`${right.title} ${right.description}`, rankingKeywords) -
        scoreText(`${left.title} ${left.description}`, rankingKeywords),
    )
    .slice(0, options.variant === "technical" ? 4 : 3);

  const skills = [...resume.skills]
    .sort(
      (left, right) =>
        scoreText(`${right.label} ${right.items.join(" ")}`, rankingKeywords) -
        scoreText(`${left.label} ${left.items.join(" ")}`, rankingKeywords),
    )
    .slice(0, options.variant === "technical" ? 6 : 5);

  const name = profile?.candidate?.full_name || resume.name || "Candidate";
  const companySlug = slugify(report.company || "role");

  return {
    resumeSource: {
      id: source.id,
      label: source.label,
      path: source.path,
    },
    opportunity: {
      company: report.company,
      role: report.role,
      score: report.score,
      url: report.url,
      archetype: report.archetype,
    },
    draft: {
      name,
      fileName: `${slugify(name)}-${companySlug}.pdf`,
      headline: buildHeadline(
        profile,
        report,
        options.variant,
        options.tone,
        options.headlineOverride,
      ),
      summary: buildSummary(
        profile,
        resume,
        report,
        options.tone,
        options.variant,
        options.summaryOverride,
      ),
      contactLines: buildContactLines(profile, resume),
      competencies: focusKeywords.slice(0, 8),
      experienceHighlights: experiences,
      projectHighlights: projects,
      educationHighlights: resume.education.slice(0, 3),
      skillHighlights: skills,
      nextSteps: report.nextSteps.slice(0, 3),
      variant: options.variant,
      tone: options.tone,
      format: options.format,
      targetLabel: `${report.role} · ${report.company}`,
    },
  };
}

function renderHtml(payload) {
  const templatePath = join(projectRoot, "templates", "cv-template.html");
  let html = readFileSync(templatePath, "utf8");
  const { draft } = payload;
  const candidate = payload.resumeSource;

  const contact = {
    EMAIL: draft.contactLines.find((line) => line.includes("@")) || "",
    LINKEDIN_URL:
      draft.contactLines.find((line) => line.includes("linkedin")) || "",
    PORTFOLIO_URL:
      draft.contactLines.find(
        (line) =>
          line.includes("github.com") ||
          line.includes("http") ||
          line.includes("portfolio"),
      ) || "",
    LOCATION:
      draft.contactLines.find(
        (line) => !line.includes("@") && !line.includes("http") && !line.includes("github"),
      ) || "",
  };

  const replacements = {
    LANG: "en",
    PAGE_WIDTH: draft.format === "a4" ? "210mm" : "8.5in",
    NAME: draft.name,
    EMAIL: contact.EMAIL,
    LINKEDIN_URL: contact.LINKEDIN_URL.startsWith("http")
      ? contact.LINKEDIN_URL
      : `https://${contact.LINKEDIN_URL}`,
    LINKEDIN_DISPLAY: contact.LINKEDIN_URL,
    PORTFOLIO_URL: contact.PORTFOLIO_URL.startsWith("http")
      ? contact.PORTFOLIO_URL
      : `https://${contact.PORTFOLIO_URL}`,
    PORTFOLIO_DISPLAY: contact.PORTFOLIO_URL,
    LOCATION: contact.LOCATION,
    SECTION_SUMMARY: "Professional Summary",
    SUMMARY_TEXT: escapeHtml(draft.summary),
    SECTION_COMPETENCIES: "Core Competencies",
    COMPETENCIES: draft.competencies
      .map((item) => `<span class="competency-tag">${escapeHtml(item)}</span>`)
      .join(""),
    SECTION_EXPERIENCE: "Work Experience",
    EXPERIENCE: draft.experienceHighlights
      .map(
        (entry) => `
      <div class="job">
        <div class="job-header">
          <div class="job-company">${escapeHtml(entry.heading)}</div>
          <div class="job-period">${escapeHtml(entry.subheading)}</div>
        </div>
        <ul>
          ${entry.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
        </ul>
      </div>`,
      )
      .join(""),
    SECTION_PROJECTS: "Projects",
    PROJECTS: draft.projectHighlights
      .map(
        (project, index) => `
      <div class="project">
        <div class="project-title">${escapeHtml(project.title)}${
          index === 0 ? '<span class="project-badge">Top match</span>' : ""
        }</div>
        <div class="project-desc">${escapeHtml(project.description)}</div>
      </div>`,
      )
      .join(""),
    SECTION_EDUCATION: "Education",
    EDUCATION: draft.educationHighlights
      .map(
        (entry) => `
      <div class="edu-item">
        <div class="edu-header">
          <div class="edu-degree">${escapeHtml(entry)}</div>
        </div>
      </div>`,
      )
      .join(""),
    SECTION_CERTIFICATIONS: "Certifications",
    CERTIFICATIONS: "",
    SECTION_SKILLS: "Skills",
    SKILLS: draft.skillHighlights
      .map(
        (group) => `
      <div class="skill-category">
        <div class="skill-label">${escapeHtml(group.label)}</div>
        <div class="skill-items">${escapeHtml(group.items.join(", "))}</div>
      </div>`,
      )
      .join(""),
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }

  return { html, candidate };
}

async function maybeWriteHtml(html, pathLike) {
  if (!pathLike) {
    return null;
  }

  const outputPath = resolve(projectRoot, pathLike);
  mkdirSync(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  return outputPath;
}

async function maybeWritePdf(html, draft, options) {
  if (!options.pdfOut) {
    return null;
  }

  const workdir = await mkdtemp(join(tmpdir(), "career-ops-resume-draft-"));
  const htmlPath = join(workdir, `${slugify(draft.name)}-${slugify(draft.targetLabel)}.html`);
  const pdfPath = resolve(projectRoot, options.pdfOut);

  mkdirSync(dirname(pdfPath), { recursive: true });
  await writeFile(htmlPath, html, "utf8");

  await execFileAsync("node", [
    join(projectRoot, "generate-pdf.mjs"),
    htmlPath,
    pdfPath,
    `--format=${options.format}`,
  ]);

  return pdfPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.report) {
    console.error(
      "Usage: node resume-draft.mjs --report reports/<report>.md [--resume-id frontend] [--resume-path resumes/frontend.md] [--variant balanced|technical|execution] [--tone 0-100] [--format letter|a4] [--json] [--html-out /tmp/out.html] [--pdf-out output/out.pdf]",
    );
    process.exit(1);
  }

  const profile = loadProfile();
  const source = resolveResumeSource(profile, options);

  if (!existsSync(source.path)) {
    console.error(
      `Resume source not found: ${source.path}. Configure resume_sources in config/profile.yml or create cv.md.`,
    );
    process.exit(1);
  }

  const reportPath = resolve(projectRoot, options.report);
  if (!existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exit(1);
  }

  const [resumeMarkdown, reportMarkdown] = await Promise.all([
    readFile(source.path, "utf8"),
    readFile(reportPath, "utf8"),
  ]);

  const resume = parseResumeMarkdown(resumeMarkdown);
  const report = parseReportMarkdown(reportMarkdown);
  const payload = buildDraft({ profile, resume, report, options, source });
  const { html } = renderHtml(payload);
  const htmlOut = await maybeWriteHtml(html, options.htmlOut);
  const pdfOut = await maybeWritePdf(html, payload.draft, options);

  const response = {
    ...payload,
    htmlOut,
    pdfOut,
  };

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  console.log(`Resume source: ${source.label} (${source.path})`);
  console.log(`Target role: ${payload.opportunity.role} @ ${payload.opportunity.company}`);
  console.log(`Variant: ${payload.draft.variant} · Tone: ${payload.draft.tone}`);
  if (htmlOut) {
    console.log(`HTML: ${htmlOut}`);
  }
  if (pdfOut) {
    console.log(`PDF: ${pdfOut}`);
  }
}

main().catch((error) => {
  console.error("resume-draft.mjs failed:", error.message);
  process.exit(1);
});
