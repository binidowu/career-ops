# Interview Intel: Furniture Bank — AI Forward Analytics & Data Associate

**Report:** reports/001-furniture-bank-2026-04-15.md
**Generated:** 2026-04-22
**Source URL:** https://www.charityvillage.com/jobs/it-support-web-interface-design/contract-full-time?jobId=294091
**Score / legitimacy:** 3.0/5 · High Confidence
**Method:** Derived from the existing evaluation report, cv.md, config/profile.yml, and story bank. Any question marked `[inferred from evaluation]` is reasoned from local material, not sourced from external candidate reports.

## Process Overview
- **Archetype:** AI Transformation + Agentic/Automation (hybrid)
- **Role shape:** Build data dashboards and automated reports to eliminate manual coordination overhead at a Toronto nonprofit, connecting Salesforce, Typeform, and Google Workspace.
- **Core hiring problem:** A technical generalist who can make data visible and usable for non-technical staff — reducing the "coordination tax" of manually pulling reports. Not a pure ML/AI role; think data automation with light AI integration.
- **Role logistics:** Hybrid (Toronto, ON) · May–October 2026 (approx. 6 months) · $25–$30/hr
- **Candidate context:** AI/ML Engineer building production-grade agentic systems and RAG pipelines
- **Current prep assets:** 5 interview-map row(s), 0 story-bank match(es), 5 evaluation-story fallback(s), 20 tracked keyword(s)
- **Research depth:** Internal sources only — this draft has not run live external interview research.

## Strategic Readout
- A technical generalist who can make data visible and usable for non-technical staff — reducing the "coordination tax" of manually pulling reports. Not a pure ML/AI role; think data automation with light AI integration.
- Role level: Entry Level (explicitly stated) Candidate level: Entry/Junior — this is a natural fit. No need to oversell seniority.
- Strategy: Lead with proof, not credentials
- This posting explicitly says "work samples prioritized over credentials." This is perfect for Ayomide's profile: strong project portfolio, limited formal work experience. The unconventional application (Substack DM, not resume submission) means the pitch matters more than the CV format.
- The hook for the application: Reference a concrete data problem you've solved (Bike Theft Agent: LLM over Pandas to answer natural-language queries over structured data) Map it to their problem: "You need to make data answerable without staff learning SQL. That's exactly the use case I built the Bike Theft Analytics Agent for."
- If they push on experience vs. projects: "My work history reflects my path into tech, not my technical output. The projects show what I can actually build. I'd rather show you the Bike Theft Agent repo and walk you through the architecture than list years of experience."

## Expected Interview Shape
### Round 1: Recruiter or hiring-manager screen [inferred from evaluation]
- **Estimated duration:** 20-30 min
- **What they are likely testing:** Mission alignment, availability for Hybrid (Toronto, ON), and whether you understand the practical problem behind Build data dashboards and automated reports to eliminate manual coordination overhead at a Toronto nonprofit, connecting Salesforce, Typeform, and Google Workspace..
- **How to prepare:** Open by translating your strongest project into their "coordination tax" problem, not by reciting generic AI buzzwords.

### Round 2: Practical technical walkthrough [inferred from evaluation]
- **Estimated duration:** 45-60 min
- **What they are likely testing:** How you would connect data sources, automate reporting, and make outputs usable for non-technical staff across Looker Studio, Google Sheets, Salesforce.
- **How to prepare:** Be ready to walk one end-to-end build from data ingest to user-facing output, including guardrails and trade-offs.

### Round 3: Team or stakeholder collaboration round [inferred from evaluation]
- **Estimated duration:** 30-45 min
- **What they are likely testing:** Communication with non-technical partners, prioritization under ambiguity, and how you handle gaps in tool familiarity without becoming defensive.
- **How to prepare:** Use support, documentation, and dashboard stories to prove you can translate technical work for operational teams.

### Round 4: Case or work-sample discussion [inferred from evaluation]
- **Estimated duration:** 30-45 min
- **What they are likely testing:** The posting emphasizes "work samples prioritized over credentials," so expect scrutiny of repo choices, scope, and practical impact.
- **How to prepare:** Keep one repo openable in your head: architecture, trade-offs, bugs, what changed after feedback, and what you would improve next.

## Likely Questions
### Technical
- **Question:** Walk me through how you have used Python to solve a real operational problem. [inferred from evaluation]
  **Why this is likely:** Python is explicitly called out in the report match table.
  **Best angle for you:** Used across Bike Theft Agent, RAG System, FootIQ, ML project
- **Question:** Walk me through how you have used SQL to solve a real operational problem. [inferred from evaluation]
  **Why this is likely:** SQL is explicitly called out in the report match table.
  **Best angle for you:** Bicycle Theft Recovery project (ETL, feature engineering); listed in skills
- **Question:** Walk me through how you have used Data pipelines / ETL to solve a real operational problem. [inferred from evaluation]
  **Why this is likely:** Data pipelines / ETL is explicitly called out in the report match table.
  **Best angle for you:** "ETL, feature engineering" in Bicycle Theft project
- **Question:** Walk me through how you have used AI integration in workflows to solve a real operational problem. [inferred from evaluation]
  **Why this is likely:** AI integration in workflows is explicitly called out in the report match table.
  **Best angle for you:** LangChain tool-calling, OpenAI SDK across multiple projects
- **Question:** Walk me through how you have used Dashboard / reporting to solve a real operational problem. [inferred from evaluation]
  **Why this is likely:** Dashboard / reporting is explicitly called out in the report match table.
  **Best angle for you:** Power BI in Bicycle Theft project, Matplotlib in Bike Theft Agent

### Behavioral
- **Question:** Tell me about a time you had to eliminate manual data-pulling. [inferred from evaluation]
  **Why this is likely:** The interview-prep section already maps this requirement to a reusable STAR story.
  **Best angle for you:** Loblaws fault auditing — reflection: I learned that most operational pain comes from undocumented known issues — not novel problems
- **Question:** Tell me about a time you had to create dashboards answering operational questions. [inferred from evaluation]
  **Why this is likely:** The interview-prep section already maps this requirement to a reusable STAR story.
  **Best angle for you:** Bicycle Theft Recovery ML project — reflection: I'd scope the ETL tighter next time — I over-built the pipeline relative to the dashboard needs
- **Question:** Tell me about a time you had to integrate AI into a workflow. [inferred from evaluation]
  **Why this is likely:** The interview-prep section already maps this requirement to a reusable STAR story.
  **Best angle for you:** Bike Theft Quantitative Agent — reflection: Guardrails are underestimated — I added them late and should have designed them in from the start
- **Question:** Tell me about a time you had to connect data across platforms. [inferred from evaluation]
  **Why this is likely:** The interview-prep section already maps this requirement to a reusable STAR story.
  **Best angle for you:** Modular RAG System (FinanceBench) — reflection: Benchmarking discipline is what separates a demo from a production tool

### Role-Specific
- **Question:** How would you reduce the manual coordination overhead described in this role during your first 30 to 60 days? [inferred from evaluation]
  **Why this is likely:** A technical generalist who can make data visible and usable for non-technical staff — reducing the "coordination tax" of manually pulling reports. Not a pure ML/AI role; think data automation with light AI integration.
  **Best angle for you:** Frame your answer around data visibility, lightweight automation, and outputs that non-technical teammates can trust.
- **Question:** You have not used Looker Studio directly. How would you ramp quickly without slowing the team down? [inferred from evaluation]
  **Why this is likely:** Looker Studio is listed as a gap in the evaluation, so they may probe learnability and risk.
  **Best angle for you:** "Built dashboards in Power BI; Looker Studio uses the same mental model — I can ramp in days"
- **Question:** You have not used Google Sheets directly. How would you ramp quickly without slowing the team down? [inferred from evaluation]
  **Why this is likely:** Google Sheets is listed as a gap in the evaluation, so they may probe learnability and risk.
  **Best angle for you:** Trivially transferable from Python/Pandas; not a real gap
- **Question:** You have not used Salesforce directly. How would you ramp quickly without slowing the team down? [inferred from evaluation]
  **Why this is likely:** Salesforce is listed as a gap in the evaluation, so they may probe learnability and risk.
  **Best angle for you:** No direct exp, but API integration experience applies; mention willingness to self-study

### Background Red Flags
- **Question:** Your formal work history is not a traditional engineering path. Why should we trust your projects? [inferred from evaluation]
  **Why this is likely:** This question follows from the gap between candidate context and the specifics of the posting.
  **Best angle for you:** Lead with shipped proof, repos, and the fact that your technical output is easier to verify than titles.
- **Question:** Are you genuinely available for the stated Hybrid (Toronto, ON) setup and May–October 2026 (approx. 6 months)? [inferred from evaluation]
  **Why this is likely:** This question follows from the gap between candidate context and the specifics of the posting.
  **Best angle for you:** Answer directly and concretely; avoid vague reassurance.
- **Question:** This role appears below your stated compensation target. Why is it still worth considering for you? [inferred from evaluation]
  **Why this is likely:** This question follows from the gap between candidate context and the specifics of the posting.
  **Best angle for you:** Answer honestly: frame it as a deliberate trade-off for scope, mission, or proof-building rather than pretending comp does not matter.

## Story Bank Mapping
| # | Likely question/topic | Best story | Fit | Gap? | Next move |
|---|----------------------|------------|-----|------|-----------|
| 1 | Eliminate manual data-pulling | Loblaws fault auditing | partial | yes | Promote Loblaws fault auditing into story-bank.md so it becomes reusable across interviews. |
| 2 | Create dashboards answering operational questions | Bicycle Theft Recovery ML project | partial | yes | Promote Bicycle Theft Recovery ML project into story-bank.md so it becomes reusable across interviews. |
| 3 | Practical AI integration in workflows | Bike Theft Quantitative Agent | partial | yes | Promote Bike Theft Quantitative Agent into story-bank.md so it becomes reusable across interviews. |
| 4 | Connect data across platforms | Modular RAG System (FinanceBench) | partial | yes | Promote Modular RAG System (FinanceBench) into story-bank.md so it becomes reusable across interviews. |
| 5 | Make data accessible to non-technical staff | Centennial tech support role | partial | yes | Promote Centennial tech support role into story-bank.md so it becomes reusable across interviews. |

## Evaluation Story Map
| # | Requirement | Story | Best angle |
|---|-------------|-------|------------|
| 1 | Eliminate manual data-pulling | Loblaws fault auditing | I learned that most operational pain comes from undocumented known issues — not novel problems |
| 2 | Create dashboards answering operational questions | Bicycle Theft Recovery ML project | I'd scope the ETL tighter next time — I over-built the pipeline relative to the dashboard needs |
| 3 | Practical AI integration in workflows | Bike Theft Quantitative Agent | Guardrails are underestimated — I added them late and should have designed them in from the start |
| 4 | Connect data across platforms | Modular RAG System (FinanceBench) | Benchmarking discipline is what separates a demo from a production tool |
| 5 | Make data accessible to non-technical staff | Centennial tech support role | The format of the documentation matters as much as the content — visual FAQs outperformed wall-of-text notes |

## Background Framing
- **Likely concern:** Your formal work history is not a traditional engineering path. Why should we trust your projects? [inferred from evaluation]
  **Recommended framing:** Lead with shipped proof, repos, and the fact that your technical output is easier to verify than titles.
- **Likely concern:** Are you genuinely available for the stated Hybrid (Toronto, ON) setup and May–October 2026 (approx. 6 months)? [inferred from evaluation]
  **Recommended framing:** Answer directly and concretely; avoid vague reassurance.
- **Likely concern:** This role appears below your stated compensation target. Why is it still worth considering for you? [inferred from evaluation]
  **Recommended framing:** Answer honestly: frame it as a deliberate trade-off for scope, mission, or proof-building rather than pretending comp does not matter.

## Technical Prep Checklist
- [ ] Refresh one concrete example for Python. — why: Used across Bike Theft Agent, RAG System, FootIQ, ML project
- [ ] Refresh one concrete example for SQL. — why: Bicycle Theft Recovery project (ETL, feature engineering); listed in skills
- [ ] Refresh one concrete example for Data pipelines / ETL. — why: "ETL, feature engineering" in Bicycle Theft project
- [ ] Refresh one concrete example for AI integration in workflows. — why: LangChain tool-calling, OpenAI SDK across multiple projects
- [ ] Refresh one concrete example for Dashboard / reporting. — why: Power BI in Bicycle Theft project, Matplotlib in Bike Theft Agent
- [ ] Prepare a calm ramp-up answer for Looker Studio. — why: Looker Studio is a flagged gap and could become a trust check.
- [ ] Memorize the mitigation line for Looker Studio. — why: "Built dashboards in Power BI; Looker Studio uses the same mental model — I can ramp in days"
- [ ] Prepare a calm ramp-up answer for Google Sheets. — why: Google Sheets is a flagged gap and could become a trust check.
- [ ] Memorize the mitigation line for Google Sheets. — why: Trivially transferable from Python/Pandas; not a real gap
- [ ] Prepare a calm ramp-up answer for Salesforce. — why: Salesforce is a flagged gap and could become a trust check.

## Company Signals
- **Vocabulary to mirror:** AI Transformation + Agentic/Automation (hybrid), Build (dashboards, automated reports, data integrations), Data analytics, workflow automation, nonprofit operations, coordination tax, work samples prioritized over credentials, natural-language queries over structured data, non-technical staff, automated reporting
- **Emphasize:** A technical generalist who can make data visible and usable for non-technical staff — reducing the "coordination tax" of manually pulling reports. Not a pure ML/AI role; think data automation with light AI integration.
- **Emphasize:** Proof over pedigree: lead with shipped artifacts and measured outcomes.
- **Emphasize:** Usability for non-technical teammates matters as much as technical correctness here.
- **Emphasize:** Learnability is part of the interview: show how you close tool gaps fast.
- **Avoid:** Do not pitch this as a pure AI/ML research role if the report says the actual work is dashboards, integrations, and automation.
- **Avoid:** Do not bluff direct experience with tools like Salesforce or Looker Studio if the evaluation flags them as gaps.
- **Avoid:** Do not get defensive about non-traditional work history; redirect to repo quality, architecture choices, and operational impact.

## Questions To Ask Them
- What would a genuinely strong first automation win look like in the first 60 days for this Build (dashboards, automated reports, data integrations)? [inferred from evaluation]
- Which parts of the current workflow create the most coordination overhead for staff today? [inferred from evaluation]
- Which of Looker Studio, Google Sheets, Salesforce are hard requirements on day one, and which are reasonable ramp-up areas for the new hire? [inferred from evaluation]

