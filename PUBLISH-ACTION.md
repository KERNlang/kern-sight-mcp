# Publishing the GitHub Action to the Marketplace

## Checklist

- [ ] **1. Create the repository**
  Create a new public repo: `KERNlang/kern-mcp-security-action` on GitHub.

- [ ] **2. Copy `ci/action.yml` to root as `action.yml`**
  The current `action.yml` lives in `ci/` and references `${{ github.action_path }}/../dist/cli.js`, which assumes it is a subdirectory of the monorepo. For a standalone repo, this path will not resolve. See the note below on adjustments.

- [ ] **3. Copy necessary metadata**
  Include a README, icon/branding assets, and LICENSE in the new repo root.

- [ ] **4. Push to `main`**

- [ ] **5. Create a GitHub release with tag `v1`**
  Use the GitHub UI or CLI:
  ```bash
  git tag v1
  git push origin v1
  ```
  Then create a release from that tag.

- [ ] **6. Publish to the Marketplace**
  Go to the repo **Settings** and select **"Publish this Action to the GitHub Marketplace"**. GitHub will walk through the listing form (categories, description, icon).

- [ ] **7. Verify it is usable**
  The action should now be referenceable in any workflow as:
  ```yaml
  uses: KERNlang/kern-mcp-security-action@v1
  ```

---

## Important: CLI resolution in a standalone repo

The current `action.yml` references:

```
${{ github.action_path }}/../dist/cli.js
```

This path assumes the action lives in the `ci/` subdirectory of the monorepo. In a standalone repo, `github.action_path` points to the repo root, so `../dist/cli.js` will not exist.

**Recommended fix -- use the npm approach.** The action already includes the step:

```
npm install -g kern-mcp-security@latest
```

This is the simplest path. Make sure the action's `run` step invokes the globally installed CLI (`kern-mcp-security`) rather than a local `dist/cli.js` path. No bundling required.
