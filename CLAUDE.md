# Instructions for Claude

## Git workflow

- Never commit or push directly to `main`. A GitHub repository rule rejects
  direct pushes to it.
- For every change, create a new branch from an up-to-date `origin/main`,
  commit there, and push the branch to `origin`
  (`git push -u origin <branch>`). Then open a pull request into `main`.
- Name branches after the change, in short kebab-case (for example,
  `demo-callback-alerts`).
- When asked to "commit" or "push", follow this flow; don't ask whether to
  use `main`.
