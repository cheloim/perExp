## Description
<!-- What does this PR do? Why? -->

## Related
<!-- Link to issue and/or spec -->
- Closes #<issue-number>
- Spec: `specs/features/<feature>.spec.yaml`

## Type
- [ ] New feature (full spec)
- [ ] Enhancement (lite spec)
- [ ] Bug fix (bugfix spec)
- [ ] Refactor
- [ ] Documentation only
- [ ] Infrastructure/CI

## Spec
- [ ] Spec file exists: `specs/features/<feature>.spec.yaml`
- [ ] Spec type matches change type (full/lite/bugfix)
- [ ] Spec status is correct (`implemented` or `in-progress`)
- [ ] `github_issue` field links to originating issue (if applicable)
- [ ] Requirements match implementation

## Documentation
- [ ] `docs/<feature>.md` created/updated (if applicable)
- [ ] `docs/Roadmap.md` updated OR `python scripts/generate_roadmap.py` run
- [ ] `docs/Data-Model.md` updated (if entities changed)
- [ ] `docs/API-Reference.md` updated (if endpoints changed)
- [ ] `docs/_Sidebar.md` updated (if new page added)
- [ ] `docs/Features.md` updated (if new feature)

## Testing
- [ ] `npm run typecheck` passes (frontend)
- [ ] `npm run lint` passes (frontend)
- [ ] `ruff check app/` passes (backend)
- [ ] Manual testing completed

## Side Effects (mandatory)
- [ ] Modified files reviewed for adjacent/related issues
- [ ] State management: mutations update query cache (not fire-and-forget)
- [ ] Cross-device sync: server-side state persisted (not just localStorage)
- [ ] New model columns have migration scripts registered in deploy.yml

## OAuth/SSO (if applicable)
- [ ] `prompt` parameter configured (select_account, consent, or none)
- [ ] `access_type` matches use case (offline only if refresh token needed AND used)
- [ ] TypeScript type definition includes all used parameters
- [ ] Consent screen behavior tested (first login + repeat login)
- [ ] Refresh token stored AND used (if applicable)

## Deployment
- [ ] Migration script is idempotent (if applicable)
- [ ] Rebuild required? Backend: yes/no, Frontend: yes/no
- [ ] Environment variables documented (if new)

## Screenshots
<!-- If UI changes, include before/after -->
