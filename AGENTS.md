# Web Project Instructions

This file provides project-specific guidance for web development work in this repository.

## Stack and Defaults
- Prefer **TypeScript over JavaScript** for new code unless there is a strong reason not to.
- Prefer setups that are easy to run locally and easy to deploy as static sites.
- Keep the project structure compatible with **GitHub Pages** when that is a likely deployment target.

## Local Development
- Assume multiple web projects may run locally at the same time.
- Do **not** rely on fixed dev ports by default.
- Prefer local servers that automatically fall through to the **next available port** when the default port is occupied.
- Avoid wasting time manually searching for a free port.
- After startup, note the actual localhost URL and use that for testing and debugging.
- Keep local startup commands simple and documented in `README.md`.

### Vite Guidance
- For Vite projects, allow the dev server to use the next available port automatically.
- Do **not** enable `strictPort` by default unless the project has a specific reason to require one fixed port.

## GitHub Pages
- Not every project needs the same deployment setup.
- Choose the simplest GitHub Pages approach that matches the project:

### 1. Plain static site
Use this when the project is already plain HTML/CSS/JS and does not need a build step.
- Configure the repository so GitHub Pages serves the correct branch and folder.
- A GitHub Actions workflow is usually **not** necessary in this case.

### 2. Built static site
Use this when the project uses Vite, TypeScript, npm, or another build step.
- Configure the project so the production build outputs a static site suitable for GitHub Pages.
- Configure asset and base paths so the site works from a repository subpath when needed.
- In this case, a **GitHub Actions** deployment workflow is usually the right solution.

## GitHub Pages Settings
- Ensure the repository's GitHub Pages settings match the deployment method.
- If deploying a plain static site, the Pages source should point to the correct branch and directory.
- If deploying via GitHub Actions, Pages should be configured to use the GitHub Actions workflow.
- Do not leave the deployment method ambiguous.

## GitHub Actions
- Only add a deployment workflow when the project actually needs a build or automated deployment step.
- When used, keep the workflow in `.github/workflows/`.
- The workflow should install dependencies if needed, build the site, and deploy the generated static output.
- Do not add unnecessary workflow complexity to very simple projects.

## .gitignore
- Configure `.gitignore` according to the actual stack used by the project.
- For Node/TypeScript projects, ignore at least:
  - `node_modules/`
  - `dist/`
  - `.env`
  - `.env.*`
  - common editor and OS clutter
- Do not commit generated build artifacts unless the repository intentionally relies on that workflow.

## README
- Document the deployment approach clearly in `README.md`.
- The README should state:
  - how to run the project locally,
  - whether the local server auto-selects the next free port,
  - how the project is deployed,
  - whether GitHub Pages uses a branch/folder or GitHub Actions,
  - any required base-path or repository-name configuration,
  - any important setup constraints.

## Verification
- Verify that:
  - the local server starts successfully,
  - the actual localhost URL is identified correctly,
  - the production build succeeds when the project has one,
  - the built site works with the configured base path,
  - the GitHub Pages configuration matches the intended deployment method,
  - any deployment files present are coherent and current.
