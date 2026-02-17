# BetiPredict - African Prediction Market Platform

BetiPredict is a Polymarket-style prediction market platform specifically designed for the African market, with initial focus on Zambia. It allows users to bet on sports outcomes using a peer-to-peer trading system.

## 🚀 Features

### Core MVP Features
- **Prediction Markets**: Binary YES/NO markets for sports events
- **Order Book System**: Limit and market orders with price discovery
- **Real-time Trading**: Live price updates and order matching
- **Sports Focus**: Football (soccer) with emphasis on Zambian and African leagues
- **User-friendly Interface**: Clean, responsive design optimized for mobile
- **Demo Mode**: Pre-loaded with sample markets and demo balance

### Technical Architecture
- **Frontend**: Next.js 14 + React + TypeScript + TailwindCSS
- **Backend**: Next.js API routes + Prisma ORM
- **Database**: SQLite (development), PostgreSQL (production)
- **Real-time**: WebSockets for live updates
- **Authentication**: Ready for Supabase integration

## 📋 Market Categories

### Primary Focus
- **Football**: Zambian Super League, Premier League, Champions League, Africa Cup of Nations

### Popular Markets
- Match Results (Win/Draw/Loss converted to YES/NO)
- Over/Under Goals
- First Goal Scorer
- Correct Score

## 🛠 Installation & Setup

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Local Development

1. **Clone and Install**
```bash
git clone <repository-url>
cd betipredict
npm install
```

2. **Database Setup**
```bash
npx prisma migrate dev --name init
npx prisma generate
```

3. **Environment Variables**
Create `.env.local`:
```env
DATABASE_URL="file:./dev.db"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"
```

4. **Run Development Server**
```bash
npm run dev
```

5. **Access Application**
Open http://localhost:3000

### Database Schema

The application uses the following main entities:
- **Users**: Account management and balance tracking
- **Markets**: Prediction events with YES/NO outcomes
- **Orders**: Buy/sell orders in the order book
- **Positions**: User holdings in each market
- **Transactions**: Financial transaction history

## 💰 Trading System

### How It Works
1. **Market Creation**: Event organizers create markets with specific questions
2. **Price Discovery**: Users place buy/sell orders, creating a liquid market
3. **Trading**: Users trade YES/NO shares representing outcomes
4. **Resolution**: When the event concludes, correct shares pay out K1.00 each

### Price Mechanics
- Prices represent probabilities (0.00 to 1.00)
- YES price + NO price = 1.00 (fully collateralized)
- Market prices reflect real-time supply and demand

### Order Types
- **Market Orders**: Execute immediately at current market price
- **Limit Orders**: Execute only at specified price or better

## 🌍 African Market Focus

### Zambia-Specific Features
- **Mobile Money Integration**: Ready for Airtel Money and MTN Mobile Money
- **Local Sports**: Zambian Super League markets
- **Cultural Design**: UI optimized for African users
- **Regulatory Compliance**: Designed for Zambian betting regulations

### Popular Sports
- Football (primary focus)
- Basketball
- Tennis
- Rugby

## 📱 Mobile Optimization

The application is fully responsive and optimized for:
- Mobile-first design
- Touch interactions
- Slow internet connections
- Low-end devices

## 🔮 Future Roadmap

### Phase 2 Features
- **User Authentication**: Complete signup/login system
- **Payment Integration**: Mobile money deposits/withdrawals
- **Smart Contracts**: Blockchain-based settlement
- **Live Betting**: In-play markets
- **Social Features**: User profiles and leaderboards

### Phase 3 Features
- **Mobile Apps**: Native iOS/Android applications
- **Advanced Markets**: Multiple outcome markets
- **API**: Public API for third-party integration
- **Analytics**: Market insights and predictions

## 🚀 Deployment

### Production Deployment
1. **Database**: Switch to PostgreSQL
2. **Environment**: Set production environment variables
3. **Build**: `npm run build`
4. **Deploy**: Deploy to Vercel, AWS, or similar

### Environment Variables (Production)
```env
DATABASE_URL="postgresql://..."
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="production-secret"
AIRTEL_MONEY_API_KEY="..."
MTN_MOBILE_MONEY_API_KEY="..."
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support, please contact:
- Email: support@betipredict.com
- Discord: [Community Discord]
- Twitter: @BetiPredict

## ⚠️ Disclaimer

BetiPredict is a prediction market platform for entertainment purposes. Users must be of legal betting age in their jurisdiction. Please bet responsibly and within your means.

---

**BetiPredict - The Future of African Sports Betting** 🇿🇲⚽
