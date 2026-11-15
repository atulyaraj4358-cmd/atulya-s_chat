# Atulya's Chat — liquid-glass realtime chat (GitHub Pages + Supabase)

> ⚠️ **SECURITY WARNING.** In the default `ADMIN_MODE = "simple"`, "admin" is just the name `atulya`.
> **Anyone can type that name**, and the simple-mode DELETE policy lets any holder of the public anon key
> delete any message (even via the browser console). Use simple mode only for casual/private use.
> For anything public, switch to `"secure"`.

## 5-step setup
1. **Supabase project:** create one at supabase.com → *Project Settings → API*; copy the **Project URL** and the **anon public** key.
2. **Database:** open *SQL Editor*, paste all of `schema.sql`, click *Run*.
3. **Configure:** put the URL and anon key in the top two constants of `script.js`.
   Never use the `service_role` key.
4. **Deploy:** push `index.html`, `style.css`, `script.js` to a GitHub repo → *Settings → Pages → Deploy from branch*.
5. **Embed** (snippet below).

## Secure admin mode (recommended for public use)
1. Supabase → *Authentication → Users* → add one user (your admin email + password).
2. *Authentication → Providers → Email* → turn **off** "Allow new users to sign up".
3. In `schema.sql`, run the **MODE B** block instead of the MODE A policies (swap in your email).
4. In `script.js` set `ADMIN_MODE = "secure"` and `ADMIN_EMAIL` to the same email.
   Entering the name `atulya` now asks for the password, and only the authenticated admin can delete or use that name.

## iframe snippet
```html
<iframe src="https://YOUR-USER.github.io/YOUR-REPO/" style="width:100%;height:100dvh;border:0;border-radius:24px" allow="clipboard-write" loading="lazy" title="Chat"></iframe>
```

## Notes
- The server rate limit is per `user_name` (15/min), so it is spam friction, not strong protection.
- The pinned SDK is loaded from jsDelivr; add an SRI hash if you want to lock it down.
- Sessions use `sessionStorage` with an in-memory fallback when the iframe blocks storage.
