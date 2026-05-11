# Supply Chain Compromise — Detection, Response, Rollback

**Document ID:** D10-G
**Owner:** Kristian JV Sacdalan (Founder, acting DPO)
**Last reviewed:** 2026-05-11
**Next review:** 2027-05-11

---

A supply-chain compromise is when a dependency we did not write — npm package, Docker base image, GitHub Action, transitive dep — is intentionally backdoored, takes over a maintainer account, or ships a malicious version. Recent industry examples (event-stream, ua-parser-js, colours/faker, xz-utils) all followed the same shape: a trusted name shipped a bad version, and consumers running `npm install` pulled it on next CI run.

This runbook keeps Clerque's response under 1 hour from detection to deploy.

## Detection signals

- npm advisory email or GitHub Dependabot alert flags a package we depend on (direct or transitive).
- A new release of a known package suddenly adds a postinstall script, network call, or obfuscated code.
- `npm ci` log shows an unexpected version bump despite a clean lockfile.
- Sentry / runtime reports show outbound connections to unfamiliar hosts.
- The package's GitHub repo is suddenly archived, transferred, or its maintainer changes.

## Response — in order

### 1. Freeze deploys

Stop CI/CD immediately. In Railway/Vercel, pause auto-deploys. Do **not** run `npm install` anywhere until step 2 is done.

### 2. Identify the compromised package and the path to it

```bash
# Confirm the package is in our tree at all and at what version
npm ls <package-name>

# Show every dependency path that pulls it in (direct + transitive)
npm ls <package-name> --all

# Inspect what changed between the bad version and the previous one
npm view <package-name> versions --json
npm view <package-name>@<bad-version>
npm diff --diff=<package-name>@<good-version> --diff=<package-name>@<bad-version>
```

Record findings in the IR log: which package, which version is compromised, which version is the last known good, whether it is a direct or transitive dep.

### 3. Pin the previous-known-good version

For a **direct** dependency, edit `package.json`:

```bash
# From the affected workspace (e.g. apps/api or packages/db)
npm install --save-exact <package-name>@<good-version>
```

For a **transitive** dependency, use npm overrides in the root `package.json`:

```json
{
  "overrides": {
    "<package-name>": "<good-version>"
  }
}
```

Then regenerate the lockfile cleanly:

```bash
rm -rf node_modules
npm install --package-lock-only
npm ci
```

### 4. Verify integrity

```bash
# Confirm the resolved version is the pinned one everywhere it appears
npm ls <package-name>

# Audit
npm audit --omit=dev

# Run the test suite to confirm the rollback is functionally clean
npm run test --workspaces

# Check the package's tarball integrity against the registry
npm view <package-name>@<good-version> dist.integrity
# Compare with the integrity field in package-lock.json
grep -n "<package-name>" package-lock.json
```

If the lockfile integrity hashes match the registry-reported hashes for the *good* version, the rollback is verified.

### 5. Search for compromise artefacts

If the bad version executed in our infra (CI ran it, a deploy shipped it), assume a credential touched by that process is compromised. Run the `INCIDENT_RESPONSE.md` § D10-F **Credential Compromise** playbook for:

- Railway deploy tokens used by CI.
- Any env var the package could read (`process.env`).
- GitHub Actions secrets exposed during the affected workflow runs.

Pull the AuditLog forensic query from D10-F to scope tenant-side exposure.

### 6. Deploy the rollback

```bash
git checkout -b hotfix/pin-<package-name>
git add package.json package-lock.json
git commit -m "security: pin <package-name>@<good-version> — supply chain compromise"
git push origin hotfix/pin-<package-name>
```

Open a PR, self-review, merge, and let Railway/Vercel auto-deploy. Confirm via `npm ls` against the deployed Railway shell that the good version is what's running.

### 7. Communicate

- If no tenant data was exposed: internal-only note, post-mortem within 7 days.
- If tenant data was exposed via the bad version's behaviour: escalate to `INCIDENT_RESPONSE.md` § D10-C **Data Breach** and start the 72-hour NPC clock.

## Prevention — standing controls

- Dependabot enabled on the GitHub repo for security updates.
- `npm ci` (not `npm install`) in CI to honour the lockfile exactly.
- Lockfile committed for every workspace.
- No `postinstall` scripts in our own packages, so any added `postinstall` in `node_modules` stands out in `npm install` output.
- Annual review of the dependency tree to drop unused packages (smaller surface).
