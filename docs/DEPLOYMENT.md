# BetiPredict — Deployment Guide

## Prerequisites

- **Vercel account** (free tier works for starting)
- **GitHub repository** with the BetiPredict codebase pushed
- **PostgreSQL database** (Supabase, Neon, or Railway recommended)
- **Namecheap domain** (betipredict.com)
- **football-data.org API key** (free tier: 10 requests/minute)
- **Airtel Money API credentials** (from Airtel Developer Portal)

---

## Step 1: Push Code to GitHub

```bash
cd betipredict
git init  # if not already a repo
git remote add origin https://github.com/YOUR_USERNAME/betipredict.git
git add -A
git commit -m "Initial deployment"
git push -u origin main
```

---

## Step 2: Set Up PostgreSQL Database

### Option A: Supabase (Recommended)
1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Choose a region close to your users (e.g., `eu-west-1` for Africa)
3. Copy the **Connection string** from Settings → Database
4. Format: `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`

### Option B: Neon
1. Go to [neon.tech](https://neon.tech) → **New Project**
2. Copy the connection string

### Run Migrations
```bash
# Set DATABASE_URL in your .env first
npx prisma migrate deploy
```

---

## Step 3: Deploy to Vercel

### 3a. Import Project
1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repository
3. Framework: **Next.js** (auto-detected)
4. Root Directory: `betipredict` (or `.` if repo root)

### 3b. Configure Environment Variables
In Vercel → Project Settings → Environment Variables, add:

| Variable | Value | Required |
|----------|-------|----------|
| `DATABASE_URL` | Your PostgreSQL connection string | ✅ |
| `NEXTAUTH_SECRET` | Random 32+ char string (`openssl rand -base64 32`) | ✅ |
| `NEXTAUTH_URL` | `https://betipredict.com` | ✅ |
| `FOOTBALL_DATA_API_KEY` | Your football-data.org API key | ✅ |
| `CRON_SECRET` | Random secret for cron job auth | ✅ |
| `NEXT_PUBLIC_ADMIN_EMAILS` | Comma-separated admin emails | ✅ |
| `AIRTEL_MONEY_CLIENT_ID` | Airtel API client ID | For payments |
| `AIRTEL_MONEY_CLIENT_SECRET` | Airtel API client secret | For payments |
| `AIRTEL_MONEY_WEBHOOK_SECRET` | Webhook signature secret | For payments |
| `MTN_MOMO_SUBSCRIPTION_KEY` | MTN API subscription key | For payments |
| `MTN_MOMO_API_USER` | MTN API user UUID | For payments |
| `MTN_MOMO_API_KEY` | MTN API key | For payments |

### 3c. Deploy
Click **Deploy**. Vercel will:
1. Install dependencies
2. Run `prisma generate`
3. Build the Next.js app
4. Deploy to a `.vercel.app` URL

---

## Step 4: Connect Namecheap Domain (betipredict.com)

### 4a. Add Domain in Vercel
1. Go to Vercel → Project → **Settings** → **Domains**
2. Add `betipredict.com`
3. Also add `www.betipredict.com` (redirects to apex)
4. Vercel will show you the DNS records needed

### 4b. Configure Namecheap DNS

**Option A: Use Vercel DNS (Recommended)**
1. Log in to [namecheap.com](https://namecheap.com) → **Domain List**
2. Click **Manage** next to `betipredict.com`
3. Under **Nameservers**, select **Custom DNS**
4. Enter Vercel's nameservers:
   ```
   ns1.vercel-dns.com
   ns2.vercel-dns.com
   ```
5. Save changes
6. Wait 5–30 minutes for DNS propagation

**Option B: Use Namecheap DNS with CNAME/A Records**
1. In Namecheap → **Advanced DNS**
2. Delete any existing A/AAAA/CNAME records for `@` and `www`
3. Add these records:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | @ | `76.76.21.21` | Automatic |
| CNAME | www | `cname.vercel-dns.com` | Automatic |

4. Save and wait for propagation (up to 48 hours, usually < 30 min)

### 4c. Verify in Vercel
1. Go back to Vercel → **Settings** → **Domains**
2. Both `betipredict.com` and `www.betipredict.com` should show ✅
3. Vercel automatically provisions SSL certificates

---

## Step 5: Set Up Cron Jobs

BetiPredict needs 3 recurring cron jobs. Use **Vercel Cron** or an external service.

### Option A: Vercel Cron (vercel.json)
Create `vercel.json` in project root:
```json
{
  "crons": [
    {
      "path": "/api/cron/sync-games",
      "schedule": "0 */2 * * *"
    },
    {
      "path": "/api/cron/resolve",
      "schedule": "*/15 * * * *"
    },
    {
      "path": "/api/cron/reconcile",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

**Important**: Set the `CRON_SECRET` env var, and Vercel will automatically include it.

### Option B: External Cron (cron-job.org)
1. Go to [cron-job.org](https://cron-job.org) (free)
2. Create 3 jobs:

| Job | URL | Schedule |
|-----|-----|----------|
| Sync Games | `https://betipredict.com/api/cron/sync-games` | Every 2 hours |
| Resolve Markets | `https://betipredict.com/api/cron/resolve` | Every 15 minutes |
| Reconcile Payments | `https://betipredict.com/api/cron/reconcile` | Every 10 minutes |

3. Add header `Authorization: Bearer YOUR_CRON_SECRET` to each job

---

## Step 6: Configure Payment Webhooks

### Airtel Money
1. In the Airtel Developer Portal → **App Settings**
2. Set callback URL to: `https://betipredict.com/api/payments/callback`
3. Set the webhook secret to match your `AIRTEL_MONEY_WEBHOOK_SECRET` env var

### MTN MoMo
1. In the MTN Developer Portal → **Subscriptions**
2. Set callback URL to: `https://betipredict.com/api/payments/callback`

---

## Step 7: Run Database Migration on Production

```bash
# Using Vercel CLI
npx vercel env pull .env.production.local
DATABASE_URL="your_production_url" npx prisma migrate deploy
```

Or use the Vercel dashboard → **Functions** tab → run migration via API.

---

## Step 8: Post-Deployment Verification

### Checklist
- [ ] Visit `https://betipredict.com` — page loads
- [ ] Visit `https://betipredict.com/api/health` — returns `{ "status": "healthy" }`
- [ ] Sign up a new account
- [ ] Verify notifications bell works
- [ ] Test deposit flow (Airtel Money / MTN MoMo)
- [ ] Place a test trade on a live market
- [ ] Check admin panel at `/admin` (logged in with admin email)
- [ ] Verify cron jobs are running (check `/api/cron/sync-games`)
- [ ] Check SSL certificate is valid (padlock in browser)
- [ ] Test on mobile device

---

## Troubleshooting

### Build fails on Vercel
- Check that `DATABASE_URL` is set in Vercel environment variables
- Ensure `prisma generate` runs during build (it's automatic with `postinstall`)

### Database connection errors
- Verify connection string includes `?sslmode=require` for cloud databases
- Check that the database allows connections from Vercel's IP ranges

### Domain not working
- DNS propagation can take up to 48 hours
- Use [dnschecker.org](https://dnschecker.org) to verify propagation
- Ensure nameservers are correctly set in Namecheap

### Payments not working
- Check that webhook URLs are configured correctly
- Verify API credentials are set in Vercel environment variables
- Check Vercel function logs for errors
