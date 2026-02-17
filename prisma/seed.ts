import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Start seeding...')

  // Create demo user
  const demoUser = await prisma.user.upsert({
    where: { id: 'demo-user-id' },
    update: {},
    create: {
      id: 'demo-user-id',
      email: 'demo@betipredict.com',
      username: 'demo-user',
      fullName: 'Demo User',
      balance: 1000,
      isVerified: true,
    },
  })

  console.log('Created demo user:', demoUser)

  // Create sample markets
  const markets = [
    {
      title: "Zambia vs Nigeria",
      description: "Africa Cup of Nations Qualifier",
      category: "football",
      subcategory: "africa-cup-of-nations",
      question: "Will Zambia win against Nigeria?",
      yesPrice: 0.45,
      noPrice: 0.55,
      volume: 500,
      liquidity: 1000,
      status: 'ACTIVE' as const,
      resolveTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      creatorId: demoUser.id,
    },
    {
      title: "Manchester United vs Liverpool",
      description: "Premier League Match",
      category: "football",
      subcategory: "premier-league",
      question: "Will Manchester United win?",
      yesPrice: 0.35,
      noPrice: 0.65,
      volume: 800,
      liquidity: 1200,
      status: 'ACTIVE' as const,
      resolveTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      creatorId: demoUser.id,
    },
    {
      title: "Arsenal vs Chelsea",
      description: "London Derby - Over/Under 2.5 goals",
      category: "football",
      subcategory: "premier-league",
      question: "Will there be over 2.5 goals?",
      yesPrice: 0.60,
      noPrice: 0.40,
      volume: 300,
      liquidity: 600,
      status: 'ACTIVE' as const,
      resolveTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
      creatorId: demoUser.id,
    },
  ]

  for (const marketData of markets) {
    const market = await prisma.market.upsert({
      where: { 
        question: marketData.question 
      },
      update: marketData,
      create: marketData,
    })
    console.log('Created market:', market.title)
  }

  console.log('Seeding finished.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
