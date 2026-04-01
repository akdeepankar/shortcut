#!/usr/bin/env node
/**
 * D1 Database Setup Script
 * Creates a Cloudflare D1 database and initializes the schema for durable transcript storage.
 * 
 * Usage: npm run setup-d1
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const AUTH_EMAIL = process.env.CLOUDFLARE_AUTH_EMAIL;
const GLOBAL_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY;

if (!ACCOUNT_ID) {
    console.error('❌ CLOUDFLARE_ACCOUNT_ID is required in .env.local');
    process.exit(1);
}

function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (AUTH_EMAIL && GLOBAL_KEY) {
        headers['X-Auth-Email'] = AUTH_EMAIL;
        headers['X-Auth-Key'] = GLOBAL_KEY;
    } else if (API_TOKEN) {
        headers['Authorization'] = `Bearer ${API_TOKEN}`;
    } else {
        console.error('❌ No Cloudflare credentials found');
        process.exit(1);
    }
    return headers;
}

async function cfFetch(path, options = {}) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`;
    const response = await fetch(url, {
        ...options,
        headers: { ...getHeaders(), ...options.headers },
    });
    return response.json();
}

async function main() {
    console.log('\n🏗️  Cloudflare D1 Setup for Video Intelligence\n');

    // Step 1: Check if database already exists
    let dbId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    
    if (dbId) {
        console.log(`✅ Using existing D1 database: ${dbId}`);
    } else {
        // Create new database
        console.log('📦 Creating D1 database: video-intelligence...');
        const createResult = await cfFetch('/d1/database', {
            method: 'POST',
            body: JSON.stringify({ name: 'video-intelligence' }),
        });

        if (createResult.errors?.length > 0) {
            // Check if it already exists
            if (createResult.errors[0]?.message?.includes('already exists')) {
                console.log('⚠️  Database "video-intelligence" already exists. Fetching ID...');
                const listResult = await cfFetch('/d1/database?name=video-intelligence');
                dbId = listResult.result?.[0]?.uuid;
            } else {
                console.error('❌ Failed to create database:', createResult.errors);
                process.exit(1);
            }
        } else {
            dbId = createResult.result?.uuid;
        }

        if (!dbId) {
            console.error('❌ Could not determine database ID');
            process.exit(1);
        }

        console.log(`✅ D1 Database ID: ${dbId}`);
        console.log(`\n📝 Add this to your .env.local:\n`);
        console.log(`   CLOUDFLARE_D1_DATABASE_ID="${dbId}"\n`);
    }

    // Step 2: Create schema
    console.log('🔧 Initializing schema...');
    
    const createTable = await cfFetch(`/d1/database/${dbId}/query`, {
        method: 'POST',
        body: JSON.stringify({
            sql: `CREATE TABLE IF NOT EXISTS transcripts (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL,
                text TEXT NOT NULL,
                type TEXT DEFAULT 'segment',
                start_time TEXT,
                end_time TEXT,
                timestamp_sec REAL,
                objects TEXT,
                colors TEXT,
                ocr_text TEXT,
                user_id TEXT DEFAULT 'global',
                video_url TEXT,
                uploaded_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            )`,
        }),
    });

    if (createTable.errors?.length > 0) {
        console.error('❌ Schema creation failed:', createTable.errors);
    } else {
        console.log('✅ Table "transcripts" ready');
    }

    // Create indexes
    const indexes = [
        { name: 'idx_transcripts_video_id', col: 'video_id' },
        { name: 'idx_transcripts_user_id', col: 'user_id' },
        { name: 'idx_transcripts_type', col: 'type' },
    ];

    for (const idx of indexes) {
        await cfFetch(`/d1/database/${dbId}/query`, {
            method: 'POST',
            body: JSON.stringify({
                sql: `CREATE INDEX IF NOT EXISTS ${idx.name} ON transcripts(${idx.col})`,
            }),
        });
        console.log(`✅ Index "${idx.name}" ready`);
    }

    console.log('\n🎉 D1 setup complete!\n');
    console.log('Architecture:');
    console.log('  ┌─────────────────────────┐');
    console.log('  │   D1 (Source of Truth)   │  ← Full text, no size limits');
    console.log('  │   transcripts table      │');
    console.log('  └───────────┬─────────────┘');
    console.log('              │');
    console.log('  ┌───────────▼─────────────┐');
    console.log('  │   Vectorize (Search)     │  ← Embeddings + metadata');
    console.log('  │   transcript index       │');
    console.log('  │   visual_transcript idx  │');
    console.log('  └─────────────────────────┘');
    console.log('');
}

main().catch(console.error);
