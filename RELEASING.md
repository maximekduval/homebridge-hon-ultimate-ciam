# Releasing

How a new version of `homebridge-hon-ultimate-mk` reaches npm and the Homebridge
UI.

## Steps

1. In a pull request, bump `version` in `package.json` and `package-lock.json`
   and add a `## X.Y.Z` section at the top of `CHANGELOG.md`. `npm test` fails
   when the version has no changelog section, so a release cannot go out
   without notes. Merge it once CI is green.
2. On GitHub, go to Releases > Draft a new release, create the tag `vX.Y.Z` on
   `main`, leave the description empty and publish.
3. Two workflows start by themselves:
   - **Release** stages the package on npm.
   - **Release notes** copies the `## X.Y.Z` section of `CHANGELOG.md` into the
     description of the GitHub release.
4. Approve the staged version with 2FA on npmjs.com (package > Versions), or run
   `npm stage approve homebridge-hon-ultimate-mk@X.Y.Z`. npm first validates the
   package for a couple of minutes; the approval is available after that.

The **Release** workflow authenticates with npm trusted publishing, configured
on npmjs.com for this repository and `release.yml` with the stage-only
permission, so no npm token is stored in GitHub.

## Release notes in the Homebridge UI

When a plugin is updated, the Homebridge UI shows the description of the GitHub
release `vX.Y.Z` as the release notes, and `CHANGELOG.md` as the full changelog.
It reads both from the GitHub repository found in `homepage`, or else `bugs`, of
`package.json`, with anonymous requests. So:

- the repository must be public, otherwise the UI shows "Could not retrieve
  release notes";
- the GitHub release must exist with a description that is not empty, which the
  **Release notes** workflow takes care of.

To fill a release that already exists, or to create one for an existing tag, run
the **Release notes** workflow from the Actions tab and give it the tag, for
example `v2.2.2`. A description written by hand is never overwritten. To preview
the notes of a version, run `node scripts/changelog-section.mjs 2.2.2`.

## Using this in another plugin

Copy `scripts/changelog-section.mjs` and `.github/workflows/release-notes.yml`,
keep a `CHANGELOG.md` with one `## X.Y.Z` section per version, and make sure
`homepage` or `bugs` in `package.json` points to the public GitHub repository.
