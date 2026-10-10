import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "tomokichi-diary-api",
    compatibilityDate: "2026-08-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/index.ts",
    // No workers.dev URL: it would sit outside Cloudflare Access and outside the
    // custom domain, which is exactly the door this is meant to close.
    workersDev: false,
    observability: { enabled: true },
    // The public face of the API. Admin traffic arrives instead through the admin
    // Worker's service binding, behind Cloudflare Access.
    domains: ["api.tomokichidiary.com"],
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
    // ADMIN_TOKEN is a secret: `wrangler secret put ADMIN_TOKEN --name tomokichi-diary-api`.
    // It is never committed, and a missing value closes the admin API.
    env: {
      // Where the contact form redirects back to after a submission.
      PUBLIC_SITE_URL: bindings.text("https://tomokichidiary.com"),
      // The Access application in front of admin.tomokichidiary.com. Neither value
      // is secret — both appear in the login redirect — but both must match
      // exactly or every identity token is rejected.
      ACCESS_TEAM_DOMAIN: bindings.text("tomoki-ttttt.cloudflareaccess.com"),
      ACCESS_AUD: bindings.text("edce2137d11aa91a88cb2ee68c87365a53ee0a8026b5694fccce977e02b8e02e"),
      PUBLIC_MEDIA_URL: bindings.text("https://media.tomokichidiary.com"),
      TURNSTILE_EXPECTED_HOSTNAME: bindings.text("tomokichidiary.com,www.tomokichidiary.com"),
      // Admin calls are same-origin through the admin Worker, so CORS is only for
      // local development against a deployed API.
      ALLOWED_ORIGINS: bindings.text(
        "https://tomokichidiary.com,https://www.tomokichidiary.com,https://tomokichi-diary-web.tomoki-ttttt.workers.dev,http://localhost:4321,http://127.0.0.1:4321,http://localhost:5173",
      ),
      // Migrations live in the repository's `migrations/`; `pnpm db:migrate`
      // passes that directory to `cf d1 migrations apply`.
      DB: bindings.d1({ name: "tomokichi-diary", id: "b799453b-ada9-454e-81dc-26999c2c29db" }),
      MEDIA: bindings.r2({ name: "tomokichi-diary-media" }),
      // Each contact is mailed to the blog's inbox, where it is read and
      // answered from Gmail (the reader is the Reply-To). Pinned to that one
      // address: it must be a verified destination in Email Routing, and the
      // sender's domain must have Email Routing enabled.
      CONTACT_MAIL: bindings.sendEmail({
        destinationAddress: "tomokichidiary@gmail.com",
        allowedSenderAddresses: ["noreply@tmkch.io"],
      }),
      CONTACT_MAIL_FROM: bindings.text("noreply@tmkch.io"),
      CONTACT_MAIL_TO: bindings.text("tomokichidiary@gmail.com"),
      // A copy of every message is filed on the shared inquiry platform
      // (github.com/tomoki013/inquiry-platform, SDK pinned in package.json)
      // through its `Intake` entrypoint: submit only, no reads. `props` is what
      // the platform checks — this Worker may file for `tomokichi-diary` and
      // nothing else, and the slug must match INQUIRY_PROJECT_SLUG in
      // src/inquiry.ts. The project must be registered on the platform, or every
      // submission is refused.
      INQUIRY: bindings.worker({
        worker: "tomokichi-admin-core",
        exportName: "Intake",
        props: {
          caller: "tomokichi-diary-api",
          projects: ["tomokichi-diary"],
          allowUnassigned: false,
        },
      }),
      // The admin's お問い合わせ screen works this site's tickets through the
      // platform's `ProjectOperator` entrypoint: the same props rule, so this
      // Worker operates `tomokichi-diary` and sees nothing of any other project.
      // Nothing is set up on the platform's API gateway (admin.tmkch.io) or its
      // Access app; who may use the screen is this site's own admin gate.
      INQUIRY_OPERATOR: bindings.worker({
        worker: "tomokichi-admin-core",
        exportName: "ProjectOperator",
        props: { caller: "tomokichi-diary-api", projects: ["tomokichi-diary"] },
      }),
      // One submission per sender (salted IP hash) per minute. Turnstile already
      // keeps bots out; this is what stops one person pressing send in a loop.
      // The namespace is account-wide: tomokichi-studio uses the 2000s.
      CONTACT_RATE_LIMITER: bindings.rateLimit({
        namespace: "3001",
        simple: { limit: 1, period: 60 },
      }),
    },
  },
});
