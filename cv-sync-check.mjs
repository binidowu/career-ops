#!/usr/bin/env node

/**
 * cv-sync-check.mjs — Validates that the career-ops setup is consistent.
 *
 * Checks:
 * 1. A resume source exists (cv.md or configured resume_sources)
 * 2. config/profile.yml exists and has required fields
 * 3. No hardcoded metrics in _shared.md or batch/batch-prompt.md
 * 4. article-digest.md freshness (if exists)
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

const warnings = [];
const errors = [];
const profilePath = join(projectRoot, 'config', 'profile.yml');

function resolveConfiguredResumePaths() {
  if (!existsSync(profilePath)) {
    return [];
  }

  try {
    const profile = yaml.load(readFileSync(profilePath, 'utf8'));
    const sources = Array.isArray(profile?.resume_sources) ? profile.resume_sources : [];

    return sources
      .map((entry) => String(entry?.path || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// 1. Check resume source exists
const cvPath = join(projectRoot, 'cv.md');
const configuredResumePaths = resolveConfiguredResumePaths();
const resolvedResumePath = existsSync(cvPath)
  ? cvPath
  : configuredResumePaths
      .map((resumePath) => join(projectRoot, resumePath))
      .find((resumePath) => existsSync(resumePath));

if (!resolvedResumePath) {
  errors.push('No resume source found. Create cv.md in the project root or configure resume_sources in config/profile.yml.');
} else {
  const resumeContent = readFileSync(resolvedResumePath, 'utf-8');
  if (resumeContent.trim().length < 100) {
    warnings.push(`${resolvedResumePath.replace(`${projectRoot}/`, '')} seems too short. Make sure it contains your full CV.`);
  }
}

// 2. Check profile.yml exists
if (!existsSync(profilePath)) {
  errors.push('config/profile.yml not found. Copy from config/profile.example.yml and fill in your details.');
} else {
  const profileContent = readFileSync(profilePath, 'utf-8');
  const requiredFields = ['full_name', 'email', 'location'];
  for (const field of requiredFields) {
    if (!profileContent.includes(field) || profileContent.includes(`"Jane Smith"`)) {
      warnings.push(`config/profile.yml may still have example data. Check field: ${field}`);
      break;
    }
  }
}

// 3. Check for hardcoded metrics in prompt files
const filesToCheck = [
  { path: join(projectRoot, 'modes', '_shared.md'), name: '_shared.md' },
  { path: join(projectRoot, 'batch', 'batch-prompt.md'), name: 'batch-prompt.md' },
];

const metricPattern = /\b\d{2,4}\+?\s*(hours?|%|evals?|layers?|tests?|fields?|bases?)\b/gi;

for (const { path, name } of filesToCheck) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('NEVER hardcode') || line.includes('NUNCA hardcode') || line.startsWith('#') || line.startsWith('<!--')) continue;
    const matches = line.match(metricPattern);
    if (matches) {
      warnings.push(`${name}:${i + 1} — Possible hardcoded metric: "${matches[0]}". Should this be read from cv.md/article-digest.md?`);
    }
  }
}

// 4. Check article-digest.md freshness
const digestPath = join(projectRoot, 'article-digest.md');
if (existsSync(digestPath)) {
  const stats = statSync(digestPath);
  const daysSinceModified = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
  if (daysSinceModified > 30) {
    warnings.push(`article-digest.md is ${Math.round(daysSinceModified)} days old. Consider updating if your projects have new metrics.`);
  }
}

console.log('\n=== career-ops sync check ===\n');

if (errors.length === 0 && warnings.length === 0) {
  console.log('All checks passed.');
} else {
  if (errors.length > 0) {
    console.log(`ERRORS (${errors.length}):`);
    errors.forEach((error) => console.log(`  ERROR: ${error}`));
  }
  if (warnings.length > 0) {
    console.log(`\nWARNINGS (${warnings.length}):`);
    warnings.forEach((warning) => console.log(`  WARN: ${warning}`));
  }
}

console.log('');
process.exit(errors.length > 0 ? 1 : 0);
