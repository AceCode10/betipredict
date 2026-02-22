# Immediate Match Resolution Setup

This guide explains how to configure BetiPredict for immediate match resolution, ensuring matches are resolved within seconds of full-time rather than waiting up to 15 minutes.

## Problem Overview

Currently, BetiPredict checks match status every 15 minutes using football-data.org API. This means:
- Sheffield vs Sheffield Wednesday finished at 2-1
- But BetiPredict still shows "Live" until next cron run
- Users experience up to 15-minute delays in market resolution

## Solution Architecture

### 1. Multi-Layer Resolution System

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Webhook API   │───▶│  Immediate Cron  │───▶│  Main Cron      │
│  (Instant)      │    │   (2-3 minutes)  │    │  (15 minutes)   │
│                 │    │                  │    │                 │
│ • Real-time     │    │ • API-Football   │    │ • Football-data │
│ • 15-second     │    │ • Batch check    │    │ • Backup        │
│   updates       │    │ • Live games     │    │ • Grace period  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### 2. Data Provider Options

#### Option A: API-Football (Recommended)
- **Real-time updates**: Every 15 seconds
- **Coverage**: 1,200+ competitions
- **Cost**: $10/month free tier, then $29/month
- **Setup**: Sign up at https://www.api-football.com/

#### Option B: API-Sports
- **Real-time updates**: Every 15 seconds  
- **Coverage**: 2,000+ competitions
- **Cost**: $10/month free tier, then $25/month
- **Setup**: Sign up at https://api-sports.io/

#### Option C: Premium (Professional)
- **Opta/Sportsradar**: Official league data, expensive
- **Direct stadium feeds**: For major leagues only
- **Multiple providers**: Risk mitigation

## Implementation Steps

### Step 1: Configure Real-time API

1. Sign up for API-Football account
2. Get API key from dashboard
3. Add to environment variables:
   ```bash
   API_FOOTBALL_KEY=your_api_football_key_here
   ```

### Step 2: Deploy New Endpoints

The following files are already created:
- `src/lib/sports-api-realtime.ts` - Real-time API integration
- `src/app/api/cron/resolve-immediate/route.ts` - 2-minute resolution cron
- `src/app/api/webhooks/match-status/route.ts` - Instant webhook endpoint

### Step 3: Update Cron Schedule

Replace your current cron setup:

```bash
# Every 2 minutes - Immediate resolution
*/2 * * * * curl -X POST https://betipredict.com/api/cron/resolve-immediate -H "Authorization: Bearer $CRON_SECRET"

# Every 15 minutes - Main resolution (backup)
*/15 * * * * curl -X POST https://betipredict.com/api/cron/resolve -H "Authorization: Bearer $CRON_SECRET"

# Existing crons remain the same
0 */2 * * * curl -X POST https://betipredict.com/api/cron/sync-games -H "Authorization: Bearer $CRON_SECRET"
*/10 * * * * curl -X POST https://betipredict.com/api/cron/reconcile -H "Authorization: Bearer $CRON_SECRET"
```

### Step 4: Optional Webhook Setup

For truly instant resolution (under 30 seconds):

1. Configure webhook URL in your sports data provider:
   ```
   https://betipredict.com/api/webhooks/match-status
   ```

2. Set webhook secret:
   ```bash
   WEBHOOK_SECRET=your_webhook_secret_here
   ```

3. Provider will POST when matches finish:
   ```json
   {
     "matchId": 123456,
     "status": "FINISHED", 
     "winner": "HOME_TEAM",
     "finalScore": { "home": 2, "away": 1 },
     "timestamp": "2026-02-22T16:00:00Z"
   }
   ```

## Expected Performance

| Method | Resolution Time | Cost | Reliability |
|--------|----------------|------|-------------|
| Current (15-min cron) | 0-15 minutes | Free | Good |
| Immediate cron (2-min) | 0-2 minutes | $10/month | Excellent |
| Webhook + cron | 15-30 seconds | $10/month | Best |

## Testing the Setup

### 1. Test Real-time API
```bash
curl -X GET "https://v3.football.api-sports.io/fixtures?id=123456" \
  -H "x-rapidapi-key: YOUR_API_FOOTBALL_KEY"
```

### 2. Test Immediate Resolution
```bash
curl -X POST http://localhost:3000/api/cron/resolve-immediate \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### 3. Test Webhook
```bash
curl -X POST http://localhost:3000/api/webhooks/match-status \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: GENERATED_SIGNATURE" \
  -d '{
    "matchId": 123456,
    "status": "FINISHED",
    "winner": "HOME_TEAM"
  }'
```

## Monitoring and Troubleshooting

### Check Resolution Logs
```bash
# Vercel logs
vercel logs --follow

# Check specific endpoint
curl -X GET https://betipredict.com/api/cron/resolve-immediate
```

### Common Issues

1. **API Rate Limits**: Free tier has limits
   - Solution: Upgrade to paid plan or implement caching

2. **Webhook Failures**: Network issues or signature mismatch
   - Solution: Check logs, verify secret, use immediate cron as fallback

3. **Match ID Mismatches**: Different providers use different IDs
   - Solution: Map external IDs in database

## Production Deployment

1. **Deploy changes**: Push new endpoints to production
2. **Update environment**: Add API_FOOTBALL_KEY and WEBHOOK_SECRET
3. **Update cron**: Replace 15-minute schedule with 2-minute schedule
4. **Monitor**: Watch for immediate resolution of finished matches

## Cost Analysis

- **API-Football**: $29/month for real-time data
- **External Cron**: $5-10/month (EasyCron, Cron-job.org)
- **Total**: ~$35-40/month for sub-2-minute resolution

Compare to user experience improvement and competitive advantage.

## Future Enhancements

1. **Multiple API providers**: Risk mitigation
2. **Machine learning**: Predict match end times
3. **Push notifications**: Alert users when markets resolve
4. **Mobile optimization**: Faster updates on mobile apps

This setup ensures BetiPredict resolves matches immediately after full-time, providing the user experience expected by modern betting platforms.
