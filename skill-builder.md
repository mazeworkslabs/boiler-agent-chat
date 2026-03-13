# Add Agent Skills

Agent Skills är en öppen standard (dec 2025) för att ge AI-agenter domänspecifik expertis via `SKILL.md`-filer. Fungerar med Claude, Gemini, Codex, Cursor, m.fl.

## Snabbstart

```bash
# Installera Anthropics officiella document-skills (docx, xlsx, pptx, pdf)
npx skills add anthropics/skills --skill docx --skill xlsx --skill pptx --skill pdf

# Eller installera alla skills från repot
npx skills add anthropics/skills --all

# Lista tillgängliga skills innan du installerar
npx skills add anthropics/skills --list
```

## Rikta mot specifika agenter

```bash
# Installera för specifika agenter
npx skills add anthropics/skills -a claude-code -a gemini-cli

# Stödda agenter (urval): claude-code, codex, cursor, gemini-cli,
# github-copilot, windsurf, kiro-cli, roo, amp, opencode, trae, cline, goose
```

## Hantera skills

```bash
# Sök efter skills
npx skills find <keyword>

# Lista installerade skills
npx skills list

# Kolla uppdateringar
npx skills check

# Uppdatera
npx skills update

# Ta bort
npx skills remove <skill-name>
```

## Installationskällor

```bash
# GitHub shorthand
npx skills add owner/repo

# Full GitHub URL
npx skills add https://github.com/owner/repo

# Direkt path till en specifik skill i ett repo
npx skills add https://github.com/owner/repo/tree/main/skills/web-design-guidelines

# Lokal path
npx skills add ./my-local-skills

# GitLab
npx skills add https://gitlab.com/org/repo
```

## Scope

```bash
# Projekt-scope (default) — installeras i workspace
npx skills add anthropics/skills --skill docx

# Globalt scope — tillgänglig i alla projekt
npx skills add anthropics/skills --skill docx --global
```

## Var hamnar filerna?

CLI:t installerar till `.agents/skills/` och skapar symlinks till varje agents config-katalog:

```
.agents/skills/    # central plats
.claude/skills/    # symlink
.cursor/skills/    # symlink
.codex/skills/     # symlink
.gemini/skills/    # symlink
```

## Använda i en egen chat-app

Skills är modell-agnostiska markdown-filer. För en egen app:

1. Installera skills i projektet med `npx skills add`
2. Läs `SKILL.md` från disk vid runtime
3. Inkludera innehållet i system-prompten när uppgiften matchar skillens `description`
4. Fungerar identiskt oavsett om backend är Anthropic, Gemini, eller annat

Varje `SKILL.md` har YAML frontmatter med `name` och `description` — använd description för att avgöra om en skill ska triggas.

```yaml
---
name: docx
description: "Create, read, edit Word documents (.docx). Triggers on: word doc, .docx, report, memo, letter..."
---
# Instruktioner som agenten följer
...
```

## Resurser

- Spec: https://agentskills.io
- Anthropics skills: https://github.com/anthropics/skills
- Vercels CLI: https://github.com/vercel-labs/skills
- Skills directory: https://skills.sh
- Community marketplace: https://skillsmp.com