# Contributing to Status Beacon

Thanks for contributing.

## Before you start

- Use the GitHub issue templates for bugs and feature requests when possible.
- Keep pull requests scoped to one behavior change or one cleanup pass.
- Never commit secrets, `.env` files, deploy artifacts, or generated build output.

## Local workflow

1. Read [docs/setup.md](docs/setup.md) and get the app running locally.
2. Make the smallest change that fully addresses the issue.
3. Update docs when public behavior, setup, or contributor workflow changes.
4. For dashboard or landing changes, include screenshots or a short clip in the pull request when practical.

## Validation expectations

Run the narrowest checks that cover your change before opening a pull request.

- Backend: `cd backend && python -m compileall app`
- Frontend: `cd frontend && npm run build`

If you touch Docker, nginx, or environment setup, mention how you validated that slice.

## Pull request notes

- Describe the user-facing change first.
- List the validation commands you ran.
- Call out any follow-up work or known limitations.

## Good first contributions

- Small dashboard polish and wording fixes
- Documentation improvements
- New monitoring heuristics with a clear UI surface
- Better examples for telemetry ingestion