import { prisma } from './prisma'
import bcrypt from 'bcryptjs'

export async function initializeDatabase() {
  try {
    // Create demo user if it doesn't exist
    const hashedPassword = await bcrypt.hash('demo123', 12)
    const demoUser = await prisma.user.upsert({
      where: { id: 'demo-user-id' },
      update: {},
      create: {
        id: 'demo-user-id',
        email: 'demo@betipredict.com',
        password: hashedPassword,
        username: 'demo-user',
        fullName: 'Demo User',
        balance: 1000,
        isVerified: true,
      },
    })

    console.log('Demo user created/updated:', demoUser)

    // No hardcoded sample markets — markets come from the scheduled games
    // pipeline or are created by users via the Create Market modal.

    return { success: true, demoUser }
  } catch (error) {
    console.error('Database initialization error:', error)
    return { success: false, error }
  }
}
