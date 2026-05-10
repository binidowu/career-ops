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
    rewrite: process.env.RESUME_REWRITE_MODE || "off",
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
      case "opportunity-id":
        options.opportunityId = value;
        break;
      case "format":
        options.format = value === "a4" ? "a4" : "letter";
        break;
      case "rewrite":
        options.rewrite =
          value === "ai" || value === "auto" || value === "off" ? value : "off";
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

function parseListItems(section) {
  return normalizeLines(section)
    .filter((line) => /^[-•*◦]\s/.test(line))
    .map((line) => line.replace(/^[-•*◦]\s+/, "").trim())
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
  return String(value)
    .replace(/\|/g, " ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEvidenceText(value) {
  return cleanSentence(value).toLowerCase();
}

function stableHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function createId(prefix, value) {
  return `${prefix}_${stableHash(value)}`;
}

function evidenceId(sourceId, kind, index, text) {
  const sourcePart = slugify(sourceId || "resume");
  const hash = stableHash(`${sourceId}:${kind}:${index}:${normalizeEvidenceText(text)}`);
  return `evidence_${sourcePart}_${kind}_${index + 1}_${hash}`;
}

function extractMetrics(value) {
  return [
    ...new Set(
      String(value).match(
        /(?:\$[0-9,.]+[kKmM]?|\b\d+(?:[,.]\d+)*(?:\.\d+)?%?|\b[0-9,.]+(?:k|m|x)\b)/g,
      ) ?? [],
    ),
  ];
}

function extractSkills(value) {
  const skillPatterns = [
    "AI",
    "API",
    "AWS",
    "Azure",
    "CSS",
    "ETL",
    "Excel",
    "Figma",
    "Git",
    "HTML",
    "JavaScript",
    "LangChain",
    "LLM",
    "Node",
    "Power BI",
    "Python",
    "RAG",
    "React",
    "SQL",
    "Tableau",
    "TypeScript",
  ];
  const text = String(value);
  return skillPatterns.filter((skill) =>
    new RegExp(
      `(^|[^a-z0-9+#])${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9+#]|$)`,
      "i",
    ).test(text),
  );
}

function extractActions(value) {
  const actionWords =
    String(value).match(
      /\b(?:built|created|developed|implemented|led|managed|designed|automated|optimized|improved|launched|analyzed|supported|delivered|integrated|trained|coordinated|reduced|increased|streamlined)\b/gi,
    ) ?? [];
  return [...new Set(actionWords.map((word) => word.toLowerCase()))];
}

function extractOutcomes(value) {
  return cleanSentence(value)
    .split(/;\s+|,\s+(?=(?:improving|reducing|increasing|enabling|supporting|driving)\b)/i)
    .slice(1)
    .map((part) => part.trim())
    .filter(Boolean);
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

const SECTION_ALIASES = {
  summary: ["Professional Summary", "Summary", "Profile", "About"],
  experience: [
    "Work Experience",
    "Experience",
    "Professional Experience",
    "Employment History",
    "Employment",
  ],
  projects: [
    "Projects",
    "Selected Work",
    "Portfolio",
    "Case Studies",
    "Personal Projects",
    "Side Projects",
  ],
  education: ["Education", "Academic Background"],
  skills: [
    "Skills",
    "Technical Skills",
    "Core Skills",
    "Core Competencies",
    "Technologies",
  ],
  certifications: ["Certifications", "Licenses", "Credentials"],
  awards: ["Awards", "Honors"],
  publications: ["Publications"],
  volunteering: ["Volunteer Experience", "Volunteering", "Community"],
};

function extractAliasedSection(markdown, aliases) {
  for (const alias of aliases) {
    const section = extractSection(markdown, alias);
    if (section) {
      return section;
    }
  }

  return "";
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
        .filter((line) => /^[-•*◦]\s/.test(line))
        .map((line) => line.replace(/^[-•*◦]\s+/, "").trim());
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
  return parseListItems(section)
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
  return parseListItems(section)
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
  return parseListItems(section);
}

function parseSimpleListSection(section) {
  const listItems = parseListItems(section);
  return listItems.length ? listItems : normalizeLines(section);
}

function parseResumeMarkdown(markdown) {
  const heading =
    /^#\s+CV\s+--\s+(.+)$/m.exec(markdown)?.[1]?.trim() ??
    /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ??
    "Candidate";

  return {
    name: heading,
    contact: parseHeaderContact(markdown),
    summary: extractAliasedSection(markdown, SECTION_ALIASES.summary),
    experiences: parseExperiences(extractAliasedSection(markdown, SECTION_ALIASES.experience)),
    projects: parseProjects(extractAliasedSection(markdown, SECTION_ALIASES.projects)),
    education: parseEducation(extractAliasedSection(markdown, SECTION_ALIASES.education)),
    skills: parseSkills(extractAliasedSection(markdown, SECTION_ALIASES.skills)),
    certifications: parseSimpleListSection(
      extractAliasedSection(markdown, SECTION_ALIASES.certifications),
    ),
    awards: parseSimpleListSection(extractAliasedSection(markdown, SECTION_ALIASES.awards)),
    publications: parseSimpleListSection(
      extractAliasedSection(markdown, SECTION_ALIASES.publications),
    ),
    volunteering: parseSimpleListSection(
      extractAliasedSection(markdown, SECTION_ALIASES.volunteering),
    ),
  };
}

function createEvidenceItem({ source, kind, index, title, originalText, extra = {} }) {
  return {
    id: evidenceId(source.id, kind, index, `${title} ${originalText}`),
    kind,
    sourceId: source.id,
    sourcePath: source.path,
    title: cleanSentence(title || originalText || kind),
    skills: extractSkills(`${title} ${originalText}`),
    actions: extractActions(originalText),
    outcomes: extractOutcomes(originalText),
    metrics: extractMetrics(originalText),
    originalText: cleanSentence(originalText),
    confidence: originalText ? 0.82 : 0.45,
    ...extra,
  };
}

function buildResumeEvidence(resume, source) {
  const items = [];

  if (resume.summary) {
    items.push(
      createEvidenceItem({
        source,
        kind: "summary",
        index: items.length,
        title: "Professional summary",
        originalText: resume.summary,
      }),
    );
  }

  for (const [key, value] of Object.entries(resume.contact)) {
    if (value) {
      items.push(
        createEvidenceItem({
          source,
          kind: "contact",
          index: items.length,
          title: key,
          originalText: String(value),
          extra: { confidence: 0.95, metrics: [] },
        }),
      );
    }
  }

  for (const experience of resume.experiences) {
    experience.bullets.forEach((bullet) => {
      items.push(
        createEvidenceItem({
          source,
          kind: "experience",
          index: items.length,
          title: experience.role || experience.company,
          originalText: bullet,
          extra: {
            organization: experience.company,
            role: experience.role,
            location: experience.location,
            startDate: "",
            endDate: experience.period,
          },
        }),
      );
    });
  }

  resume.projects.forEach((project) => {
    items.push(
      createEvidenceItem({
        source,
        kind: "project",
        index: items.length,
        title: project.title,
        originalText: project.description || project.title,
      }),
    );
  });

  resume.skills.forEach((group) => {
    group.items.forEach((skill) => {
      items.push(
        createEvidenceItem({
          source,
          kind: "skill",
          index: items.length,
          title: group.label,
          originalText: skill,
          extra: { skills: [skill], confidence: 0.9 },
        }),
      );
    });
  });

  resume.education.forEach((entry) => {
    items.push(
      createEvidenceItem({
        source,
        kind: "education",
        index: items.length,
        title: "Education",
        originalText: entry,
        extra: { confidence: 0.9 },
      }),
    );
  });

  const simpleSections = [
    ["certification", resume.certifications],
    ["award", resume.awards],
    ["publication", resume.publications],
    ["volunteering", resume.volunteering],
  ];

  simpleSections.forEach(([kind, entries]) => {
    entries.forEach((entry) => {
      items.push(
        createEvidenceItem({
          source,
          kind,
          index: items.length,
          title: entry,
          originalText: entry,
          extra: { confidence: 0.9 },
        }),
      );
    });
  });

  return items;
}

function buildEvidenceDiagnostics(resume, evidenceItems, source) {
  const diagnostics = [];

  if (!Object.values(resume.contact).some(Boolean)) {
    diagnostics.push({
      code: "missing_contact_info",
      severity: "warning",
      message: "No contact information was parsed from the resume source.",
      sourceId: source.id,
    });
  }

  const extension = source.path.split(".").pop()?.toLowerCase() ?? "";
  if (!["md", "markdown", "txt"].includes(extension)) {
    diagnostics.push({
      code: "unsupported_source_format",
      severity: "warning",
      message: "Evidence extraction currently expects normalized markdown or plain text.",
      sourceId: source.id,
    });
  }

  evidenceItems
    .filter((item) => ["experience", "project"].includes(item.kind))
    .filter((item) => !item.metrics.length && !item.outcomes.length)
    .slice(0, 8)
    .forEach((item) => {
      diagnostics.push({
        code: "weak_bullet_without_outcome",
        severity: "info",
        message: "Evidence has no parsed metric or outcome signal.",
        sourceId: source.id,
        evidenceId: item.id,
      });
    });

  const seen = new Map();
  evidenceItems.forEach((item) => {
    const key = normalizeEvidenceText(item.originalText);
    if (!key) {
      return;
    }
    const first = seen.get(key);
    if (first) {
      diagnostics.push({
        code: "duplicate_evidence",
        severity: "info",
        message: "Duplicate evidence text was parsed from the resume source.",
        sourceId: source.id,
        evidenceId: item.id,
        duplicateOf: first,
      });
      return;
    }
    seen.set(key, item.id);
  });

  return diagnostics;
}

function findUsedEvidenceIds(evidenceItems, draft) {
  const draftText = [
    draft.summary,
    ...draft.experienceHighlights.flatMap((entry) => entry.bullets),
    ...draft.projectHighlights.flatMap((project) => [project.title, project.description]),
    ...draft.educationHighlights,
    ...draft.skillHighlights.flatMap((group) => group.items),
  ]
    .map(normalizeEvidenceText)
    .join("\n");

  return evidenceItems
    .filter((item) => {
      const original = normalizeEvidenceText(item.originalText);
      return original && draftText.includes(original);
    })
    .map((item) => item.id);
}

function countPatternMatches(text, patterns) {
  return patterns.reduce((count, pattern) => {
    const matches = text.match(pattern);
    return count + (matches?.length ?? 0);
  }, 0);
}

function classifyJobFamily(report) {
  const text = [
    report.role,
    report.archetype,
    report.summary,
    report.tldr,
    ...report.atsKeywords,
    ...report.sections.map((section) => section.body),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const scores = {
    software: countPatternMatches(text, [
      /\bsoftware\b/g,
      /\bdeveloper\b/g,
      /\bfrontend\b/g,
      /\bbackend\b/g,
      /\bfull[\s-]?stack\b/g,
      /\breact\b/g,
      /\bapi\b/g,
      /\btypescript\b/g,
    ]),
    "data/analytics": countPatternMatches(text, [
      /\bdata\b/g,
      /\banalytics?\b/g,
      /\banalyst\b/g,
      /\bdashboard\b/g,
      /\bpower\s*bi\b/g,
      /\bsql\b/g,
      /\betl\b/g,
      /\breporting\b/g,
    ]),
    "IT/support": countPatternMatches(text, [
      /\bit support\b/g,
      /\bhelp\s?desk\b/g,
      /\btechnical support\b/g,
      /\btroubleshoot/g,
      /\bservice desk\b/g,
      /\bnetwork\b/g,
    ]),
    "product/design": countPatternMatches(text, [
      /\bproduct\b/g,
      /\bdesign\b/g,
      /\bux\b/g,
      /\bui\b/g,
      /\bfigma\b/g,
      /\bprototype\b/g,
    ]),
    finance: countPatternMatches(text, [
      /\bfinance\b/g,
      /\bfinancial\b/g,
      /\baccounting\b/g,
      /\binvestment\b/g,
      /\bbudget\b/g,
      /\bforecast\b/g,
    ]),
    teaching: countPatternMatches(text, [
      /\bteacher\b/g,
      /\bteaching\b/g,
      /\beducation\b/g,
      /\binstructor\b/g,
      /\bcurriculum\b/g,
      /\bstudent\b/g,
    ]),
    "healthcare/medical": countPatternMatches(text, [
      /\bhealthcare\b/g,
      /\bmedical\b/g,
      /\bclinical\b/g,
      /\bpatient\b/g,
      /\bnursing\b/g,
      /\blicen[cs]e\b/g,
    ]),
    "operations/admin": countPatternMatches(text, [
      /\boperations?\b/g,
      /\badministrat/g,
      /\bcoordinat/g,
      /\bworkflow\b/g,
      /\bprocess\b/g,
      /\bstakeholder\b/g,
    ]),
  };

  const [family, score] = Object.entries(scores).sort((left, right) => right[1] - left[1])[0] ?? [
    "general",
    0,
  ];

  return score > 0 ? family : "general";
}

function createSectionPolicy({ enabled, label, maxItems, maxBulletsPerItem, prominence, reason }) {
  return {
    enabled,
    label,
    ...(maxItems ? { maxItems } : {}),
    ...(maxBulletsPerItem ? { maxBulletsPerItem } : {}),
    prominence,
    reason,
  };
}

function orderEnabledSections(order, policies) {
  return order.filter((section) => policies[section]?.enabled);
}

function buildEvidencePlan(evidenceItems, keywords, policies) {
  return evidenceItems
    .map((item) => {
      const sectionType =
        {
          award: "awards",
          certification: "certifications",
          contact: "contact",
          education: "education",
          experience: "experience",
          project: "projects",
          publication: "publications",
          skill: "skills",
          summary: "summary",
          volunteering: "volunteering",
        }[item.kind] ?? item.kind;
      const score = scoreText(`${item.title} ${item.originalText} ${item.skills.join(" ")}`, keywords);
      return {
        evidenceId: item.id,
        sectionType,
        score,
        reason: score > 0 ? "Matches target keywords." : "Available source evidence.",
      };
    })
    .filter((item) => policies[item.sectionType]?.enabled)
    .sort((left, right) => right.score - left.score)
    .slice(0, 24);
}

function buildResumeStrategy({ evidenceItems, keywords, report, resume }) {
  const jobFamily = classifyJobFamily(report);
  const hasProjects = resume.projects.length > 0;
  const hasCertifications = resume.certifications.length > 0;
  const hasAwards = resume.awards.length > 0;
  const hasPublications = resume.publications.length > 0;
  const hasVolunteering = resume.volunteering.length > 0;
  const warnings = [];

  const technicalRole = ["software", "data/analytics", "IT/support"].includes(jobFamily);
  const regulatedRole = ["healthcare/medical", "teaching"].includes(jobFamily);
  const projectLabel =
    jobFamily === "data/analytics"
      ? "Selected Analytics Work"
      : jobFamily === "software"
        ? "Technical Projects"
        : jobFamily === "operations/admin"
          ? "Selected Work"
          : "Relevant Projects";

  const policies = {
    summary: createSectionPolicy({
      enabled: true,
      label: "Professional Summary",
      maxItems: 1,
      prominence: "primary",
      reason: "Every tailored resume needs a concise target narrative.",
    }),
    skills: createSectionPolicy({
      enabled: resume.skills.length > 0,
      label: technicalRole ? "Technical Skills" : "Core Skills",
      maxItems: technicalRole ? 6 : 5,
      prominence: technicalRole ? "primary" : "secondary",
      reason: technicalRole
        ? "Technical and data roles screen heavily on tool and skill overlap."
        : "Skills support the role narrative without outranking direct experience.",
    }),
    projects: createSectionPolicy({
      enabled: hasProjects,
      label: projectLabel,
      maxItems: technicalRole ? 4 : 3,
      maxBulletsPerItem: 2,
      prominence: technicalRole ? "primary" : "supporting",
      reason: hasProjects
        ? technicalRole
          ? "Projects are elevated because this target role values proof-of-work."
          : "Projects are available but should support stronger direct experience."
        : "Projects are hidden because no project evidence was parsed.",
    }),
    experience: createSectionPolicy({
      enabled: resume.experiences.length > 0,
      label: regulatedRole ? "Relevant Experience" : "Work Experience",
      maxItems: jobFamily === "operations/admin" ? 4 : 5,
      maxBulletsPerItem: technicalRole ? 4 : 5,
      prominence: technicalRole ? "secondary" : "primary",
      reason: technicalRole
        ? "Experience validates delivery history after skills and proof-of-work."
        : "Direct experience is the strongest screen for this job family.",
    }),
    certifications: createSectionPolicy({
      enabled: hasCertifications,
      label: jobFamily === "healthcare/medical" ? "Licenses & Certifications" : "Certifications",
      maxItems: 4,
      prominence: regulatedRole || jobFamily === "IT/support" ? "primary" : "supporting",
      reason: hasCertifications
        ? regulatedRole || jobFamily === "IT/support"
          ? "Credentials are elevated because this job family often screens for them."
          : "Credentials are included as supporting evidence."
        : "Certifications are hidden because no credential evidence was parsed.",
    }),
    education: createSectionPolicy({
      enabled: resume.education.length > 0,
      label: "Education",
      maxItems: 3,
      prominence: jobFamily === "teaching" ? "primary" : "supporting",
      reason:
        jobFamily === "teaching"
          ? "Education is elevated because the target role values formal learning credentials."
          : "Education supports the resume after stronger role evidence.",
    }),
    awards: createSectionPolicy({
      enabled: hasAwards,
      label: "Awards",
      maxItems: 3,
      prominence: "supporting",
      reason: hasAwards ? "Awards add differentiated proof." : "Awards are hidden because none were parsed.",
    }),
    publications: createSectionPolicy({
      enabled: hasPublications,
      label: "Publications",
      maxItems: 3,
      prominence: jobFamily === "teaching" ? "secondary" : "supporting",
      reason: hasPublications
        ? "Publications add domain credibility."
        : "Publications are hidden because none were parsed.",
    }),
    volunteering: createSectionPolicy({
      enabled: hasVolunteering,
      label: "Volunteer Experience",
      maxItems: 3,
      prominence: "supporting",
      reason: hasVolunteering
        ? "Volunteer work can support values and stakeholder evidence."
        : "Volunteering is hidden because none was parsed.",
    }),
  };

  if (!hasProjects) {
    warnings.push("No project evidence was parsed, so Projects is disabled.");
  }

  if (regulatedRole && !hasCertifications) {
    warnings.push("This job family may value credentials, but no certifications or licenses were parsed.");
  }

  const orderByFamily = {
    software: ["summary", "skills", "projects", "experience", "education", "certifications"],
    "data/analytics": ["summary", "skills", "projects", "experience", "certifications", "education"],
    "IT/support": ["summary", "skills", "experience", "certifications", "projects", "education"],
    "product/design": ["summary", "projects", "skills", "experience", "education", "certifications"],
    finance: ["summary", "skills", "experience", "projects", "certifications", "education"],
    teaching: ["summary", "certifications", "experience", "education", "publications", "skills", "projects"],
    "healthcare/medical": ["summary", "certifications", "experience", "education", "skills", "projects"],
    "operations/admin": ["summary", "experience", "skills", "projects", "certifications", "education"],
    general: ["summary", "experience", "skills", "projects", "certifications", "education"],
  };
  const baseOrder = orderByFamily[jobFamily] ?? orderByFamily.general;
  const optionalTail = ["awards", "publications", "volunteering"].filter(
    (section) => !baseOrder.includes(section),
  );
  const sectionOrder = orderEnabledSections([...baseOrder, ...optionalTail], policies);
  const narrativeAngle =
    report.tldr ||
    report.summary ||
    `${report.role} candidate positioned around ${keywords.slice(0, 3).join(", ") || "role fit"}.`;

  return {
    templateId: "ayo-clean-v1",
    jobFamily,
    narrativeAngle: cleanSentence(narrativeAngle),
    sectionOrder,
    sectionPolicies: policies,
    keywordPlan: keywords,
    evidencePlan: buildEvidencePlan(evidenceItems, keywords, policies),
    warnings,
  };
}

function findEvidenceForText(evidenceItems, text, preferredKinds = []) {
  const normalizedText = normalizeEvidenceText(text);
  if (!normalizedText) {
    return [];
  }

  const exact = evidenceItems.filter(
    (item) =>
      (!preferredKinds.length || preferredKinds.includes(item.kind)) &&
      normalizeEvidenceText(item.originalText) === normalizedText,
  );
  if (exact.length) {
    return exact.map((item) => item.id);
  }

  const partial = evidenceItems.filter((item) => {
    if (preferredKinds.length && !preferredKinds.includes(item.kind)) {
      return false;
    }
    const original = normalizeEvidenceText(item.originalText);
    return original && (normalizedText.includes(original) || original.includes(normalizedText));
  });

  return partial.map((item) => item.id).slice(0, 2);
}

function matchedKeywordsForText(text, keywords) {
  const haystack = text.toLowerCase();
  return keywords.filter((keyword) => keyword && haystack.includes(keyword.toLowerCase()));
}

function createBullet({ prefix, text, evidenceItems, keywords, preferredKinds = [] }) {
  return {
    id: createId(`bullet_${prefix}`, text),
    text,
    sourceEvidenceIds: findEvidenceForText(evidenceItems, text, preferredKinds),
    matchedKeywords: matchedKeywordsForText(text, keywords),
    userEdited: false,
    locked: false,
  };
}

function createTextBlock({ id, text, evidenceItems, keywords }) {
  return {
    id,
    type: "text",
    text,
    sourceEvidenceIds: findEvidenceForText(evidenceItems, text, ["summary"]),
    matchedKeywords: matchedKeywordsForText(text, keywords),
    userEdited: false,
    locked: false,
  };
}

function sectionPolicy(strategy, type) {
  return strategy.sectionPolicies[type] ?? {
    enabled: false,
    label: type,
    prominence: "supporting",
    reason: "No policy available.",
  };
}

function buildResumeDocument({ payload, strategy, evidenceItems, options, source }) {
  const { draft } = payload;
  const keywordPlan = strategy.keywordPlan ?? [];
  const now = new Date().toISOString();
  const opportunityId =
    options.opportunityId?.trim() ||
    slugify(basename(options.report || draft.targetLabel, ".md"));
  const sections = strategy.sectionOrder
    .map((sectionType, order) => {
      const policy = sectionPolicy(strategy, sectionType);
      const section = {
        id: createId("section", `${sectionType}:${policy.label}`),
        type: sectionType,
        label: policy.label,
        enabled: policy.enabled,
        order,
        blocks: [],
      };

      if (sectionType === "summary") {
        section.blocks.push(
          createTextBlock({
            id: "summary_block",
            text: draft.summary,
            evidenceItems,
            keywords: keywordPlan,
          }),
        );
      }

      if (sectionType === "skills") {
        draft.skillHighlights
          .slice(0, policy.maxItems ?? draft.skillHighlights.length)
          .forEach((group) => {
            section.blocks.push({
              id: createId("skill_group", `${group.label}:${group.items.join(",")}`),
              type: "skillGroup",
              label: group.label,
              items: group.items,
              sourceEvidenceIds: group.items.flatMap((item) =>
                findEvidenceForText(evidenceItems, item, ["skill"]),
              ),
              matchedKeywords: matchedKeywordsForText(group.items.join(" "), keywordPlan),
              userEdited: false,
              locked: false,
            });
          });
      }

      if (sectionType === "experience") {
        draft.experienceHighlights
          .slice(0, policy.maxItems ?? draft.experienceHighlights.length)
          .forEach((entry) => {
            const [role = "", location = "", period = ""] = entry.subheading.split(" · ");
            section.blocks.push({
              id: createId("experience", `${entry.heading}:${entry.subheading}`),
              type: "experience",
              company: entry.heading,
              role,
              location,
              period,
              bullets: entry.bullets
                .slice(0, policy.maxBulletsPerItem ?? entry.bullets.length)
                .map((bullet) =>
                  createBullet({
                    prefix: "experience",
                    text: bullet,
                    evidenceItems,
                    keywords: keywordPlan,
                    preferredKinds: ["experience"],
                  }),
                ),
              userEdited: false,
              locked: false,
            });
          });
      }

      if (sectionType === "projects") {
        draft.projectHighlights
          .slice(0, policy.maxItems ?? draft.projectHighlights.length)
          .forEach((project) => {
            const evidenceIds = findEvidenceForText(
              evidenceItems,
              project.description || project.title,
              ["project"],
            );
            section.blocks.push({
              id: createId("project", `${project.title}:${project.description}`),
              type: "project",
              title: project.title,
              description: project.description,
              bullets: project.description
                ? [
                    createBullet({
                      prefix: "project",
                      text: project.description,
                      evidenceItems,
                      keywords: keywordPlan,
                      preferredKinds: ["project"],
                    }),
                  ]
                : [],
              sourceEvidenceIds: evidenceIds,
              matchedKeywords: matchedKeywordsForText(
                `${project.title} ${project.description}`,
                keywordPlan,
              ),
              userEdited: false,
              locked: false,
            });
          });
      }

      if (sectionType === "education") {
        draft.educationHighlights
          .slice(0, policy.maxItems ?? draft.educationHighlights.length)
          .forEach((entry) => {
            section.blocks.push({
              id: createId("education", entry),
              type: "listItem",
              text: entry,
              sourceEvidenceIds: findEvidenceForText(evidenceItems, entry, ["education"]),
              matchedKeywords: matchedKeywordsForText(entry, keywordPlan),
              userEdited: false,
              locked: false,
            });
          });
      }

      if (sectionType === "certifications") {
        evidenceItems
          .filter((item) => item.kind === "certification")
          .slice(0, policy.maxItems ?? 4)
          .forEach((item) => {
            section.blocks.push({
              id: createId("certification", item.id),
              type: "listItem",
              text: item.originalText,
              sourceEvidenceIds: [item.id],
              matchedKeywords: matchedKeywordsForText(item.originalText, keywordPlan),
              userEdited: false,
              locked: false,
            });
          });
      }

      if (["awards", "publications", "volunteering"].includes(sectionType)) {
        const kindBySection = {
          awards: "award",
          publications: "publication",
          volunteering: "volunteering",
        };
        evidenceItems
          .filter((item) => item.kind === kindBySection[sectionType])
          .slice(0, policy.maxItems ?? 3)
          .forEach((item) => {
            section.blocks.push({
              id: createId(sectionType, item.id),
              type: "listItem",
              text: item.originalText,
              sourceEvidenceIds: [item.id],
              matchedKeywords: matchedKeywordsForText(item.originalText, keywordPlan),
              userEdited: false,
              locked: false,
            });
          });
      }

      return section;
    })
    .filter((section) => section.enabled && section.blocks.length > 0);

  return {
    id: createId(
      "resume_doc",
      `${source.id}:${draft.targetLabel}:${options.variant}:${options.tone}:${now}`,
    ),
    opportunityId,
    resumeSourceIds: [source.id],
    templateId: "ayo-clean-v1",
    format: draft.format,
    status: "draft",
    name: draft.name,
    headline: draft.headline,
    contactLines: draft.contactLines,
    fileName: draft.fileName,
    targetLabel: draft.targetLabel,
    strategy,
    sections,
    diagnostics: [],
    userEdits: [],
    exportHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

function collectDocumentBullets(document) {
  return document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => {
      if (Array.isArray(block.bullets)) {
        return block.bullets.map((bullet) => ({
          ...bullet,
          sectionType: section.type,
          blockId: block.id,
        }));
      }
      if (block.type === "text" && block.id === "summary_block") {
        return [{
          id: block.id,
          text: block.text,
          sourceEvidenceIds: block.sourceEvidenceIds,
          matchedKeywords: block.matchedKeywords,
          sectionType: section.type,
          blockId: block.id,
        }];
      }
      return [];
    }),
  );
}

function buildRewriteRequest({ document, evidenceItems, report, strategy }) {
  const plannedEvidenceIds = new Set(strategy.evidencePlan.map((item) => item.evidenceId));
  const evidence = evidenceItems
    .filter((item) => plannedEvidenceIds.has(item.id) || ["summary", "experience", "project"].includes(item.kind))
    .slice(0, 40)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      organization: item.organization,
      role: item.role,
      skills: item.skills,
      metrics: item.metrics,
      originalText: item.originalText,
    }));

  return {
    target: {
      company: report.company,
      role: report.role,
      jobFamily: strategy.jobFamily,
      mustHaveSkills: strategy.keywordPlan,
      narrativeAngle: strategy.narrativeAngle,
    },
    truthfulnessRules: [
      "Do not invent employers, tools, dates, degrees, metrics, certifications, or responsibilities.",
      "Each rewritten bullet must cite at least one supplied sourceEvidenceIds value.",
      "Keep bullets concise, ATS-readable, and grounded in the original evidence.",
      "If evidence is weak, improve wording without adding unsupported claims.",
    ],
    document: {
      headline: document.headline,
      summary: document.sections
        .find((section) => section.type === "summary")
        ?.blocks.find((block) => block.id === "summary_block")?.text,
      bullets: collectDocumentBullets(document).filter((item) => item.id !== "summary_block"),
    },
    evidence,
    outputSchema: {
      summary: "string, optional rewritten summary",
      bullets: [
        {
          id: "existing bullet id",
          text: "rewritten bullet text",
          sourceEvidenceIds: ["evidence ids from the supplied evidence only"],
          matchedKeywords: ["keywords naturally reflected in the text"],
          risk: "none|unsupported|needs_review",
        },
      ],
    },
  };
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) {
      throw new Error("AI response did not contain a JSON object.");
    }
    return JSON.parse(match[0]);
  }
}

async function callOpenAiRewrite(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.RESUME_REWRITE_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You rewrite resumes truthfully. Return only valid JSON matching the requested schema.",
        },
        {
          role: "user",
          content: JSON.stringify(request),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI rewrite request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI rewrite response did not include message content.");
  }

  return {
    provider: "openai",
    model,
    payload: extractJsonObject(content),
  };
}

async function callAnthropicRewrite(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.RESUME_REWRITE_MODEL || process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      temperature: 0.25,
      system:
        "You rewrite resumes truthfully. Return only valid JSON matching the requested schema.",
      messages: [
        {
          role: "user",
          content: JSON.stringify(request),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic rewrite request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const content = payload?.content
    ?.map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  if (!content) {
    throw new Error("Anthropic rewrite response did not include text content.");
  }

  return {
    provider: "anthropic",
    model,
    payload: extractJsonObject(content),
  };
}

function validateRewritePayload(payload, document, evidenceItems) {
  const diagnostics = [];
  const evidenceIds = new Set(evidenceItems.map((item) => item.id));
  const bulletIds = new Set(collectDocumentBullets(document).map((bullet) => bullet.id));
  const bullets = Array.isArray(payload?.bullets) ? payload.bullets : [];

  const validBullets = bullets
    .filter((bullet) => {
      if (!bullet || typeof bullet.id !== "string" || !bulletIds.has(bullet.id)) {
        diagnostics.push({
          code: "ai_rewrite_unknown_bullet",
          severity: "warning",
          message: "AI returned a rewrite for an unknown bullet id.",
        });
        return false;
      }
      if (typeof bullet.text !== "string" || !bullet.text.trim()) {
        diagnostics.push({
          code: "ai_rewrite_empty_text",
          severity: "warning",
          message: `AI returned empty text for bullet ${bullet.id}.`,
        });
        return false;
      }
      const sourceEvidenceIds = Array.isArray(bullet.sourceEvidenceIds)
        ? bullet.sourceEvidenceIds.filter((id) => typeof id === "string" && evidenceIds.has(id))
        : [];
      if (!sourceEvidenceIds.length) {
        diagnostics.push({
          code: "ai_rewrite_missing_evidence",
          severity: "warning",
          message: `AI rewrite for bullet ${bullet.id} did not cite valid evidence.`,
        });
        return false;
      }
      return true;
    })
    .map((bullet) => ({
      id: bullet.id,
      text: cleanSentence(bullet.text),
      sourceEvidenceIds: bullet.sourceEvidenceIds.filter((id) => evidenceIds.has(id)),
      matchedKeywords: Array.isArray(bullet.matchedKeywords)
        ? bullet.matchedKeywords.filter((keyword) => typeof keyword === "string")
        : [],
      risk: bullet.risk === "unsupported" || bullet.risk === "needs_review" ? bullet.risk : "none",
    }));

  if (payload?.summary !== undefined && typeof payload.summary !== "string") {
    diagnostics.push({
      code: "ai_rewrite_invalid_summary",
      severity: "warning",
      message: "AI returned a non-string summary rewrite.",
    });
  }

  validBullets
    .filter((bullet) => bullet.risk !== "none")
    .forEach((bullet) => {
      diagnostics.push({
        code: "ai_rewrite_needs_review",
        severity: "warning",
        message: `AI marked bullet ${bullet.id} as ${bullet.risk}.`,
      });
    });

  return {
    diagnostics,
    summary: typeof payload?.summary === "string" ? cleanSentence(payload.summary) : null,
    bullets: validBullets,
  };
}

function applyRewriteToDocument(document, rewrite) {
  const bulletMap = new Map(rewrite.bullets.map((bullet) => [bullet.id, bullet]));
  const rewrittenSections = document.sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => {
      if (block.id === "summary_block" && rewrite.summary) {
        return {
          ...block,
          text: rewrite.summary,
          userEdited: false,
        };
      }

      if (!Array.isArray(block.bullets)) {
        return block;
      }

      return {
        ...block,
        bullets: block.bullets.map((bullet) => {
          const replacement = bulletMap.get(bullet.id);
          if (!replacement) {
            return bullet;
          }
          return {
            ...bullet,
            text: replacement.text,
            sourceEvidenceIds: replacement.sourceEvidenceIds,
            matchedKeywords: replacement.matchedKeywords,
            userEdited: false,
          };
        }),
      };
    }),
  }));

  return {
    ...document,
    sections: rewrittenSections,
    diagnostics: [...document.diagnostics, ...rewrite.diagnostics],
    updatedAt: new Date().toISOString(),
  };
}

async function maybeRewriteDocument({ document, evidenceItems, options, report, strategy }) {
  const rewriteMode = options.rewrite || "off";
  const diagnostics = [];

  if (rewriteMode === "off") {
    diagnostics.push({
      code: "ai_rewrite_skipped",
      severity: "info",
      message: "AI rewrite skipped; deterministic structured document returned.",
    });
    return {
      document: {
        ...document,
        diagnostics: [...document.diagnostics, ...diagnostics],
      },
      rewrite: {
        mode: rewriteMode,
        provider: null,
        model: null,
        status: "skipped",
        diagnostics,
      },
    };
  }

  const request = buildRewriteRequest({ document, evidenceItems, report, strategy });

  try {
    const result =
      (await callOpenAiRewrite(request)) ||
      (await callAnthropicRewrite(request));

    if (!result) {
      diagnostics.push({
        code: "ai_rewrite_unavailable",
        severity: rewriteMode === "ai" ? "warning" : "info",
        message:
          "AI rewrite unavailable because OPENAI_API_KEY or ANTHROPIC_API_KEY is not configured.",
      });
      return {
        document: {
          ...document,
          diagnostics: [...document.diagnostics, ...diagnostics],
        },
        rewrite: {
          mode: rewriteMode,
          provider: null,
          model: null,
          status: "fallback",
          diagnostics,
        },
      };
    }

    const validated = validateRewritePayload(result.payload, document, evidenceItems);
    const rewrittenDocument = applyRewriteToDocument(document, validated);
    return {
      document: rewrittenDocument,
      rewrite: {
        mode: rewriteMode,
        provider: result.provider,
        model: result.model,
        status: validated.bullets.length || validated.summary ? "applied" : "fallback",
        diagnostics: validated.diagnostics,
      },
    };
  } catch (error) {
    diagnostics.push({
      code: "ai_rewrite_failed",
      severity: "warning",
      message: error instanceof Error ? error.message : "AI rewrite failed; fallback document returned.",
    });
    return {
      document: {
        ...document,
        diagnostics: [...document.diagnostics, ...diagnostics],
      },
      rewrite: {
        mode: rewriteMode,
        provider: null,
        model: null,
        status: "fallback",
        diagnostics,
      },
    };
  }
}

function draftStorageRelativePath(document, fileName = `${document.id}.json`) {
  return join(
    "resume-drafts",
    slugify(document.opportunityId || "opportunity"),
    slugify(document.resumeSourceIds[0] || "resume"),
    fileName,
  );
}

async function persistResumeDraftDocument({ document, evidence, evidenceSummary, rewrite, source }) {
  const storageRecord = {
    document,
    evidence,
    evidenceSummary,
    rewrite,
    resumeSource: source,
    persistedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
  const draftRelativePath = draftStorageRelativePath(document);
  const latestRelativePath = draftStorageRelativePath(document, "latest.json");
  const indexRelativePath = join(
    "resume-drafts",
    slugify(document.opportunityId || "opportunity"),
    "latest.json",
  );
  const draftPath = resolve(projectRoot, draftRelativePath);
  const latestPath = resolve(projectRoot, latestRelativePath);
  const indexPath = resolve(projectRoot, indexRelativePath);

  mkdirSync(dirname(draftPath), { recursive: true });
  mkdirSync(dirname(indexPath), { recursive: true });

  await writeFile(draftPath, JSON.stringify(storageRecord, null, 2), "utf8");
  await writeFile(latestPath, JSON.stringify(storageRecord, null, 2), "utf8");
  await writeFile(
    indexPath,
    JSON.stringify(
      {
        draftId: document.id,
        draftPath: draftRelativePath,
        latestPath: latestRelativePath,
        opportunityId: document.opportunityId,
        resumeSourceIds: document.resumeSourceIds,
        targetLabel: document.targetLabel,
        updatedAt: document.updatedAt,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    draftPath: draftRelativePath,
    latestPath: latestRelativePath,
    indexPath: indexRelativePath,
  };
}

function parseReportSections(markdown) {
  // Match "## A) Heading" or "## A — Heading" or "## A – Heading" formats
  const matches = [...markdown.matchAll(/^##\s+([A-Z])\s*[)—–\-]\s*(.+)$/gm)];

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
  // Use the ATS keywords section when present — highest-quality signal in the report
  if (report.atsKeywords.length > 0) {
    return unique(report.atsKeywords).slice(0, 10);
  }

  // Fallback: scan report text for skill matches
  const reportText = [
    report.role,
    report.company,
    report.summary,
    report.tldr,
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
  // Title format: "# Evaluation: Company — Role" (company first, then role after dash)
  const titleMatch = /^#\s+Evaluation:\s+(.+?)\s+[—–]\s+(.+)$/m.exec(markdown);
  const evaluationReportTitleMatch =
    /^#\s+Evaluation Report\s+[—–-]\s+(.+?)\s+@\s+(.+)$/m.exec(markdown);
  const numberedTitleMatch =
    /^#\s+\d+\s+[—–-]\s+(.+?)\s+[—–-]\s+(.+)$/m.exec(markdown);
  const simpleCompanyRoleMatch = /^#\s+(.+?)\s+--\s+(.+)$/m.exec(markdown);

  const sections = parseReportSections(markdown);

  // Summary: first substantive paragraph from section B, skipping tables and bold-key lines
  const bSection = sections.find((s) => s.key === "B")?.body ?? "";
  const summaryParagraph = cleanSentence(
    bSection
      .split("\n")
      .find((line) => {
        const t = line.trim();
        return t && !t.startsWith("|") && !t.startsWith("#") && !t.startsWith("**") && !t.startsWith(">");
      }) ?? "",
  );

  // TL;DR from section A role-summary table
  const aSection = sections.find((s) => s.key === "A")?.body ?? "";
  const tldr = /\|\s*TL;DR\s*\|\s*(.+?)\s*\|/i.exec(aSection)?.[1]?.trim() ?? "";

  // Personalization suggestions from section E — shown as draft diagnostic notes
  const eSection = sections.find((s) => s.key === "E")?.body ?? "";
  const nextSteps = eSection
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .slice(0, 3)
    .map((line) => {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      // Table columns: #, Section, Current State, Proposed Change, Why
      return cells.length >= 4 ? cleanSentence(cells[3] ?? "") : "";
    })
    .filter(Boolean);

  // ATS keywords from the dedicated Keywords section at the bottom of the report
  const keywordsSection =
    extractSection(markdown, "Keywords (ATS)") ||
    extractSection(markdown, "Keywords");
  const atsKeywords = keywordsSection
    ? keywordsSection.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    role:
      titleMatch?.[2]?.trim() ??
      evaluationReportTitleMatch?.[1]?.trim() ??
      numberedTitleMatch?.[2]?.trim() ??
      simpleCompanyRoleMatch?.[2]?.trim() ??
      "Unknown role",
    company:
      titleMatch?.[1]?.trim() ??
      evaluationReportTitleMatch?.[2]?.trim() ??
      numberedTitleMatch?.[1]?.trim() ??
      simpleCompanyRoleMatch?.[1]?.trim() ??
      "Unknown company",
    score: /\*\*Score:\*\*\s*([0-9.]+)\/5/i.exec(markdown)?.[1] ?? null,
    url: /\*\*URL:\*\*\s*(.+)$/im.exec(markdown)?.[1]?.trim() ?? "",
    archetype: /\*\*Archetype:\*\*\s+(.+)$/im.exec(markdown)?.[1]?.trim() ?? "",
    summary: summaryParagraph,
    tldr,
    sections,
    nextSteps,
    atsKeywords,
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

  // Use TL;DR from the report when available — it's a concise role-specific description
  // written by the evaluator, not a hardcoded template.
  const roleContext = report.tldr
    ? cleanSentence(report.tldr).slice(0, 160)
    : reportSummary;

  const roleLine =
    roleContext ||
    (variant === "technical"
      ? `Strong fit for ${report.role} at ${report.company} with emphasis on technical depth and AI tooling.`
      : variant === "execution"
        ? `Strong fit for ${report.role} at ${report.company} with emphasis on delivery and full-stack problem-solving.`
        : `Targeting ${report.role} at ${report.company} with strong alignment on the core role requirements.`);

  const closing =
    tone >= 60
      ? (reportSummary && reportSummary !== roleContext ? reportSummary : `Ready to contribute quickly on ${report.company} problems with strong ownership.`)
      : (reportSummary && reportSummary !== roleContext ? reportSummary : "");

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
      targetRoles: source.targetRoles ?? [],
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
  const evidenceItems = buildResumeEvidence(resume, source);
  const evidenceDiagnostics = buildEvidenceDiagnostics(resume, evidenceItems, source);
  const keywordPlan = extractReportKeywords(report, resume);
  const strategy = buildResumeStrategy({
    evidenceItems,
    keywords: keywordPlan,
    report,
    resume,
  });
  const payload = buildDraft({ profile, resume, report, options, source });
  const usedEvidenceIds = findUsedEvidenceIds(evidenceItems, payload.draft);
  const deterministicDocument = buildResumeDocument({
    payload,
    strategy,
    evidenceItems,
    options,
    source,
  });
  const rewritten = await maybeRewriteDocument({
    document: deterministicDocument,
    evidenceItems,
    options,
    report,
    strategy,
  });
  const { html } = renderHtml(payload);
  const htmlOut = await maybeWriteHtml(html, options.htmlOut);
  const pdfOut = await maybeWritePdf(html, payload.draft, options);
  const evidence = {
    items: evidenceItems,
    diagnostics: evidenceDiagnostics,
  };
  const evidenceSummary = {
    totalEvidenceItems: evidenceItems.length,
    usedEvidenceItems: usedEvidenceIds.length,
    warnings: evidenceDiagnostics
      .filter((diagnostic) => diagnostic.severity === "warning")
      .map((diagnostic) => diagnostic.message),
  };
  const persistence = await persistResumeDraftDocument({
    document: rewritten.document,
    evidence,
    evidenceSummary,
    rewrite: rewritten.rewrite,
    source: payload.resumeSource,
  });

  const response = {
    ...payload,
    evidence,
    evidenceSummary,
    strategy,
    document: rewritten.document,
    rewrite: rewritten.rewrite,
    persistence,
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
  console.log(`Rewrite: ${rewritten.rewrite.status}`);
  console.log(`Draft: ${persistence.draftPath}`);
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
