# Staged workflows

`ci.yml` and `deploy.yml` belong in `.github/workflows/`. They are parked here because the session
that generated them pushed with a credential lacking GitHub's `workflow` scope, which refuses any
push that creates or updates a file under `.github/workflows/`.

To activate them:

```bash
git mv .github/workflows-staged/ci.yml .github/workflows/ci.yml
git mv .github/workflows-staged/deploy.yml .github/workflows/deploy.yml
git rm .github/workflows-staged/README.md
git commit -m "Activate CI and Pages workflows"
git push
```

`deploy.yml` additionally needs Pages switched to the "GitHub Actions" source under
*Settings → Pages* in the repository.
