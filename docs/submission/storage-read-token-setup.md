# Setting up `REINS_STORAGE_READ_TOKEN`

The Reader job (the agent's document-reading step) runs server-side with no user session, so it
needs its own read-only token to fetch PDF bytes from Supabase Storage. It must never be
`service_role` (`src/server/ingest/storage.ts` refuses that token outright).

On a hosted Supabase project `authenticator` is a reserved role — only Supabase itself can grant
a new custom role to it, so a brand-new Postgres role (the original plan) does not work here.
Instead this uses the existing `authenticated` role (already a member of `authenticator`) with an
extra RLS policy scoped to one fixed, server-only `sub` value, so the token can read every user's
documents without being tied to a real user account.

This needs the project's JWT secret, which only the project owner can read from the dashboard —
an agent cannot do this step.

## 1. Add the reader policy — done

Already applied to `pobxeauvxbrfkdukzmic`:

```sql
create policy "documents_server_reader_select" on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and auth.jwt() ->> 'sub' = '00000000-0000-4000-8000-000000000000'
);
```

`00000000-0000-4000-8000-000000000000` is a fixed, never-issued-to-a-real-user UUID reserved for
this token. It does not collide with `auth.users` because no real sign-up can produce it. Only
step 2 below needs the project owner.

## 2. Generate the JWT

Go to **Settings → API** in the dashboard and copy the **JWT Secret** (not the anon or
service_role key — the secret used to *sign* tokens).

From the repo root (it already has `jsonwebtoken` installed):

```bash
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000000', iss: 'supabase' },
  '<JWT_SECRET>',
  { expiresIn: '10y' }
);
console.log(token);
"
```

## 3. Set the env var and redeploy

Set `REINS_STORAGE_READ_TOKEN` to that token on the Vercel project (production, preview,
development), then redeploy:

```bash
vercel env add REINS_STORAGE_READ_TOKEN production
vercel deploy --prod --yes
```
