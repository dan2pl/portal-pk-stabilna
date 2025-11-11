// src/db.ts
import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/portal_pk',
});

pool.connect()
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch((err) => console.error('❌ Database connection error:', err));

export default pool;
