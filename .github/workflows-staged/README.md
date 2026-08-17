# Staged workflow change

`ci.yml` here is `.github/workflows/ci.yml` with the two things the sibling project does that this
one was missing: the parallel Coveralls upload per matrix job plus the consolidating job after
them, and Node 26 in the test matrix. It is parked here because the session that wrote it pushes
with a credential lacking GitHub's `workflow` scope, which refuses any push touching
`.github/workflows/`.

To apply it:

```bash
mv .github/workflows-staged/ci.yml .github/workflows/ci.yml
git rm -r .github/workflows-staged
git commit -am "Report coverage to Coveralls, and test on Node 26"
git push
```

Coveralls needs the repository enabled at https://coveralls.io once, after which the
`secrets.github_token` the workflow already passes is enough — no extra secret to configure.
