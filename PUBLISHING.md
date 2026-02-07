# Publishing Guide

## Prerequisites

### npm (one-time setup)

Already configured in GitHub Actions secrets:
- `NPM_TOKEN` - npm publish token

### ClawHub (one-time setup)

1. Get your ClawHub API token:
   ```bash
   npm install -g clawhub
   clawhub login
   ```

2. Copy the token from `~/.config/clawhub/config.json`:
   ```bash
   cat ~/.config/clawhub/config.json
   ```

3. Add to GitHub repo secrets:
   - Go to: https://github.com/LePetitPince/clawdo/settings/secrets/actions
   - Click "New repository secret"
   - Name: `CLAWHUB_TOKEN`
   - Value: Paste your token from config.json

## Publishing a Release

1. **Update version:**
   ```bash
   npm version 1.0.1  # or minor, major
   ```

2. **Push with tags:**
   ```bash
   git push && git push --tags
   ```

3. **Create GitHub release:**
   ```bash
   gh release create v1.0.1 \
     --title "v1.0.1" \
     --notes "Bug fixes and improvements"
   ```

   Or via GitHub web UI: https://github.com/LePetitPince/clawdo/releases/new

4. **GitHub Actions automatically:**
   - Builds TypeScript
   - Runs 195 tests
   - Publishes to npm with provenance
   - Publishes `skill/` folder to ClawHub

## Manual Publishing (Testing)

### npm
```bash
npm run build
npm test
npm publish
```

### ClawHub
```bash
clawhub publish ./skill \
  --slug clawdo \
  --name "clawdo - Task Queue" \
  --version 1.0.0 \
  --changelog "Release notes"
```

## Updating Skill Documentation

When CLI changes (new commands, flags, workflows):

1. Update code: `src/index.ts`
2. Update skill docs: `skill/SKILL.md` (in same commit!)
3. Commit atomically:
   ```bash
   git add src/index.ts skill/SKILL.md
   git commit -m "feat: add search command + update skill docs"
   ```

This ensures code and docs stay in sync.

## Versioning Strategy

- **npm version** (package.json): Source of truth
- **ClawHub version**: Extracted from git tag (e.g., `v1.0.1` → `1.0.1`)
- **Keep in sync**: Use `npm version` to bump, create release with same tag

## Checklist

Before creating a release:

- [ ] Update `CHANGELOG.md`
- [ ] Update `skill/SKILL.md` if CLI changed
- [ ] Run tests: `npm test` (all 195 passing)
- [ ] Bump version: `npm version X.Y.Z`
- [ ] Push tags: `git push --tags`
- [ ] Create GitHub release (triggers CI/CD)
- [ ] Verify npm: https://www.npmjs.com/package/clawdo
- [ ] Verify ClawHub: https://clawhub.ai/skills/clawdo

## Troubleshooting

**ClawHub publish fails:**
- Check `CLAWHUB_TOKEN` secret is set
- Check token is valid: `clawhub whoami`
- Check `skill/SKILL.md` has valid YAML frontmatter

**npm publish fails:**
- Check `NPM_TOKEN` secret is set
- Check you're logged in: `npm whoami`
- Check version doesn't already exist

**Version mismatch:**
- Git tag must match package.json version
- GitHub release uses tag (e.g., `v1.0.1`)
- Workflow extracts version by removing `v` prefix
