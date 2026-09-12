import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config({ path: new URL('.env', import.meta.url) })

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing. Add it to server/.env before starting the API.')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
