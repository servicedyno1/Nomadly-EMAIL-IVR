/**
 * Database Indexes Creation Script
 * Adds performance indexes to frequently queried collections
 */

const { MongoClient } = require('mongodb');

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   DATABASE INDEXES CREATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  const MONGO_URL = 'mongodb://localhost:27017';
  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db('test');

  const indexes = [
    // VPS Collections
    { collection: 'vpsPlansOf', index: { chatId: 1 }, name: 'chatId_1' },
    { collection: 'vpsPlansOf', index: { status: 1 }, name: 'status_1' },
    { collection: 'vpsPlansOf', index: { end_time: 1 }, name: 'end_time_1' },
    { collection: 'vpsPlansOf', index: { chatId: 1, status: 1 }, name: 'chatId_status' },
    
    // Payment Collections
    { collection: 'payments', index: { chatId: 1 }, name: 'chatId_1' },
    { collection: 'payments', index: { timestamp: -1 }, name: 'timestamp_desc' },
    { collection: 'payments', index: { chatId: 1, timestamp: -1 }, name: 'chatId_timestamp' },
    
    // Phone/Lead Collections
    { collection: 'phoneLogs', index: { chatId: 1 }, name: 'chatId_1' },
    { collection: 'phoneLogs', index: { timestamp: -1 }, name: 'timestamp_desc' },
    { collection: 'phoneLogs', index: { phoneNumber: 1 }, name: 'phoneNumber_1' },
    
    // CNAM Cache
    { collection: 'cnamCache', index: { phone: 1 }, name: 'phone_1' },
    { collection: 'cnamCache', index: { updatedAt: -1 }, name: 'updatedAt_desc' },
    
    // User Collections
    { collection: 'state', index: { lastUpdated: -1 }, name: 'lastUpdated_desc' },
    
    // Domain Collections
    { collection: 'domainsOf', index: { chatId: 1 }, name: 'chatId_1' },
    
    // Hosting Collections
    { collection: 'hostingTransactions', index: { chatId: 1 }, name: 'chatId_1' },
    { collection: 'hostingTransactions', index: { timestamp: -1 }, name: 'timestamp_desc' },
  ];

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const { collection, index, name } of indexes) {
    try {
      const coll = db.collection(collection);
      
      // Check if index already exists
      const existingIndexes = await coll.indexes();
      const indexExists = existingIndexes.some(idx => idx.name === name);
      
      if (indexExists) {
        console.log(`⏭️  ${collection}.${name} - Already exists`);
        skipped++;
      } else {
        await coll.createIndex(index, { name });
        console.log(`✅ ${collection}.${name} - Created`);
        created++;
      }
    } catch (error) {
      console.error(`❌ ${collection}.${name} - Error: ${error.message}`);
      errors++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`   INDEXES SUMMARY`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped (already exist): ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  await client.close();
})().catch(console.error);
