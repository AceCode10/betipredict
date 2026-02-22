# MVP Resolution Strategy with football-data.org (Free Tier)

This guide explains how to achieve immediate match resolution using football-data.org's free 10 calls/minute plan, avoiding the $29/month cost of premium APIs.

## Problem

- **Current**: 15-minute cron delays (unacceptable UX)
- **Premium APIs**: $29/month (expensive for MVP)
- **Free tier**: Only 10 calls/minute (seems limiting)

## Solution: Smart API Optimization

### Key Strategies

1. **Intelligent Match Selection**
   - Only check matches likely to finish soon (60+ minutes old)
   - Skip recently started matches
   - Focus on high-probability candidates

2. **Rate Limit Management**
   - Built-in 6-second delays between calls
   - Batch processing with breaks
   - Automatic backoff on rate limits

3. **Adaptive Scheduling**
   - Peak times: Every 3 minutes (6-10PM UTC)
   - Normal times: Every 5 minutes (12PM-11PM)
   - Quiet times: Every 10 minutes (overnight)

4. **Smart Caching**
   - 2-minute cache for match status
   - Avoids redundant API calls
   - Automatic cache cleanup

## Implementation Options

### Option A: Optimized Resolution (Recommended)

**Endpoint**: `/api/cron/resolve-optimized`
**Schedule**: Every 5 minutes
**API Usage**: 2-8 calls per cycle

```bash
# Cron-job.org setup
https://www.betipredict.com/api/cron/resolve-optimized
# Schedule: */5 * * * *
# Method: GET
# Header: Authorization: Bearer YOUR_CRON_SECRET
```

**How it works:**
1. Gets live matches (1 call)
2. Filters matches 60+ minutes old
3. Checks 6-8 most likely matches
4. Resolves finished markets immediately

**Expected resolution time**: 5-8 minutes after full-time

### Option B: Adaptive Resolution (Advanced)

**Endpoint**: `/api/cron/resolve-adaptive`
**Schedule**: Every 3 minutes
**API Usage**: 1-10 calls per cycle (adaptive)

```bash
# Cron-job.org setup  
https://www.betipredict.com/api/cron/resolve-adaptive
# Schedule: */3 * * * *
# Method: GET
# Header: Authorization: Bearer YOUR_CRON_SECRET
```

**How it works:**
1. Checks today's finished matches (catch-up)
2. During peak times: proactively checks likely matches
3. Adjusts frequency based on time of day
4. Maximum 10 calls/minute respected

**Expected resolution time**: 3-5 minutes during peak times

### Option C: Hybrid Approach (Best UX)

Combine both strategies:
- **Adaptive**: Primary resolver (every 3 minutes)
- **Optimized**: Backup during busy periods (every 5 minutes)
- **Original**: Final fallback (every 15 minutes)

```bash
# Primary - Adaptive
*/3 * * * * curl -X GET https://www.betipredict.com/api/cron/resolve-adaptive -H "Authorization: Bearer $CRON_SECRET"

# Backup - Optimized  
*/5 * * * * curl -X GET https://www.betipredict.com/api/cron/resolve-optimized -H "Authorization: Bearer $CRON_SECRET"

# Fallback - Original
*/15 * * * * curl -X GET https://www.betipredict.com/api/cron/resolve -H "Authorization: Bearer $CRON_SECRET"
```

## API Call Budget Analysis

### Free Tier: 10 calls/minute = 600 calls/hour

**Optimized Strategy (every 5 minutes):**
- 12 cycles/hour × 2-8 calls = 24-96 calls/hour
- **Usage**: 4-16% of available budget
- **Buffer**: Plenty of room for error

**Adaptive Strategy (every 3 minutes):**
- 20 cycles/hour × 1-10 calls = 20-200 calls/hour  
- **Usage**: 3-33% of available budget
- **Buffer**: Safe with headroom

**Hybrid Strategy:**
- Combined: ~150 calls/hour maximum
- **Usage**: 25% of available budget
- **Buffer**: Comfortable safety margin

## Performance Comparison

| Strategy | Resolution Time | API Calls/Hour | Cost | Complexity |
|----------|----------------|----------------|------|------------|
| Current | 15 minutes | 4 | Free | Low |
| Optimized | 5-8 minutes | 24-96 | Free | Medium |
| Adaptive | 3-5 minutes | 20-200 | Free | High |
| Premium API | 15-30 seconds | Unlimited | $29/month | Low |

## Setup Instructions

### 1. Deploy New Endpoints

Files are already created:
- `src/lib/sports-api-optimized.ts` - Optimized API wrapper
- `src/app/api/cron/resolve-optimized/route.ts` - 5-minute resolution
- `src/app/api/cron/resolve-adaptive/route.ts` - 3-minute adaptive resolution

### 2. Update Cron Configuration

Replace your current cron setup with one of the options above.

### 3. Monitor Performance

Check logs to ensure you're staying within rate limits:

```bash
# Check recent logs
vercel logs --follow --limit 50

# Look for these messages:
# [optimized-resolve] Used X API calls (limit: 10/minute)
# [adaptive-resolve] Adaptive cycle complete
```

### 4. Fine-tune if Needed

If you hit rate limits:
1. Increase cron interval (5→7 minutes)
2. Reduce batch size (8→6 matches)
3. Add more peak time restrictions

## Expected Results for Sheffield vs Sheffield Wednesday

**Before (Current):**
- Match ends at 2-1
- Shows "Live" for 15 minutes
- Resolves at next cron run

**After (Optimized):**
- Match ends at 2-1  
- Shows "Live" for 5-8 minutes
- Resolves during next optimized cycle

**After (Adaptive):**
- Match ends at 2-1
- Shows "Live" for 3-5 minutes  
- Resolves during next adaptive cycle

## Cost Savings

**Premium API Approach**: $29/month = $348/year
**Optimized Free Tier**: $0/month = $0/year
**Annual Savings**: $348

This allows you to invest in other MVP features while still providing acceptable resolution times.

## When to Upgrade to Premium

Consider upgrading when:
1. Monthly active users > 1,000
2. Revenue > $500/month
3. Users complain about resolution delays
4. You expand to multiple sports

Until then, the optimized free tier approach provides excellent ROI for MVP.

## Monitoring Dashboard

Add these metrics to your admin dashboard:
- Average resolution time
- API calls used per hour
- Rate limit hits
- Markets resolved per day

This helps you decide when to upgrade to premium APIs.
