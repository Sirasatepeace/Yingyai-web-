# Deploy Yingyai Academy on Render

Import `render.yaml` as a Render Blueprint from this repository. Review the
paid Starter service and 10 GB persistent disk cost before creating resources.
The disk stores SQLite, sessions, course media and documents under `/var/data`.
The Docker build intentionally excludes preview accounts, uploads and secrets.

After deployment, use the service's HTTPS URL and create the owner account in
the running service's Shell using `npm run create-admin -- <username> <password>`.
Do not put passwords in GitHub, this file or the Blueprint. The preview account
does not automatically exist on this service. Use `/admin` after signing in.

Set the `CONTACT_LINE`, `CONTACT_PHONE`, `PAY_BANK`, `PAY_ACCOUNT_NAME`,
`PAY_ACCOUNT_NO` and optional `PAY_PROMPTPAY` environment variables before
accepting paid enrollments. Set `SITE_NAME` and `SITE_NAME_TH` if needed.

Keep one service instance while SQLite and uploaded files use a single disk.
Monitor storage usage and back up the SQLite database with its backup API plus
uploaded files. Do not copy a live SQLite file without handling its WAL.
Large video uploads are additionally subject to the hosting provider's request
limits; verify these before accepting large files in production.

Deployment files are preparation only: committing them does not create a
Render service or publish a website. Provisioning requires a connected Render
account. Verify HTTPS sign-in, admin access, uploads and persistence after a
restart before inviting students.
