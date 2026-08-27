# SHAPE New Web repository workflow

- This repository is edited and pushed from multiple computers. Protect `main`
  from divergent work: before starting any task, run `git fetch origin main`
  and compare the local branch with `origin/main`. Integrate the latest remote
  changes before editing when they differ.
- Immediately before every push, fetch `origin/main` again, confirm that the
  local `main` includes it and that no unrelated changes will be overwritten.
- Push changes only to the `main` branch. Do not push work from another branch
  or to another remote branch.
