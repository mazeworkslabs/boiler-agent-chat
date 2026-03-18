import fs from "fs";
import path from "path";

export interface Skill {
  name: string;
  description: string;
  trigger?: string;
  content: string;
  filePath: string;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      meta[key] = value;
    }
  }

  return { meta, content: match[2].trim() };
}

export function loadSkills(rootDir: string): Skill[] {
  const skills: Skill[] = [];
  const skillDirs = [".claude/skills", ".agents/skills", ".agent/skills"];

  for (const skillDir of skillDirs) {
    const fullDir = path.join(rootDir, skillDir);
    if (!fs.existsSync(fullDir)) continue;

    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const skillFile = path.join(fullDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      // Skip if we already loaded a skill with the same name (deduplicate across dirs)
      const raw = fs.readFileSync(skillFile, "utf-8");
      const { meta, content } = parseFrontmatter(raw);

      const name = meta.name || entry.name;
      if (skills.some((s) => s.name === name)) continue;

      skills.push({
        name,
        description: meta.description || "",
        trigger: meta.trigger,
        content,
        filePath: skillFile,
      });
    }
  }

  return skills;
}

export function buildSkillContext(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = ["\n\n## Tillgängliga skills\n"];

  for (const skill of skills) {
    lines.push(`### ${skill.name}`);
    if (skill.description) lines.push(`*${skill.description}*`);
    lines.push("");
    lines.push(skill.content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build a compact summary of skills for the lead agent.
 * Only includes name + description — no full content.
 * This keeps the lead agent focused on delegation rather than execution.
 */
export function buildSkillSummary(skills: Skill[], agentMap: Record<string, string[]>): string {
  if (skills.length === 0) return "";

  const lines = ["\n\n## Specialist-skills (redan inladdade hos specialisterna — delegera, sök INTE på webben)\n"];

  for (const skill of skills) {
    const targets = agentMap[skill.name];
    if (!targets || targets.length === 0) continue;
    const agents = targets.join(", ");
    lines.push(`- **${skill.name}** → ${agents}${skill.description ? `: ${skill.description}` : ""}`);
  }

  return lines.join("\n");
}
