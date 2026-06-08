# Security Policy

The Foundry is currently an early public prototype. Please treat it as
developer-preview software, not a hardened production service.

## Supported Versions

Only the current public branch is actively reviewed for security fixes.

## Reporting A Vulnerability

Please do not open a public issue with secrets, exploit details, or private
dataset samples.

Instead, email the repository owner or use GitHub private vulnerability
reporting if it is enabled for the repository.

Include:

- A clear summary of the issue.
- Steps to reproduce.
- Affected files or endpoints.
- Whether the issue exposes tokens, private data, model artifacts, or host
  filesystem paths.

## Current Security Posture

- Authentication and multi-user authorization are not production-ready.
- CORS is permissive for local development.
- Runtime files are local and ignored by git.
- Hugging Face tokens and other credentials must be provided through local
  environment variables.
- The default Construct runtime is simulated.

Before production deployment, The Foundry needs explicit authentication,
authorization, audit logging, CORS restrictions, upload scanning, rate limits,
and secret storage.
