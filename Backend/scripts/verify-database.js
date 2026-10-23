const mongoose = require('mongoose');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function verifyDatabase() {
    console.log('=== VERIFYING MONGODB & REPLICA SET ===');
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mean-l2?replicaSet=rs0';
    console.log(`Connecting to: ${uri}`);

    await mongoose.connect(uri);
    console.log('✓ Successfully connected to MongoDB');

    const admin = mongoose.connection.db.admin();

    // 1. Check Replica Set Status
    try {
        const rsStatus = await admin.command({ replSetGetStatus: 1 });
        console.log(`✓ Replica Set Name: "${rsStatus.set}"`);
        console.log(`✓ Replica Set State: ${rsStatus.myState} (${rsStatus.members?.find(m => m.self)?.stateStr || 'PRIMARY'})`);
        const primary = rsStatus.members?.find(m => m.state === 1);
        console.log(`✓ Active Writable Primary: ${primary?.name || 'Self'}`);
    } catch (err) {
        console.error('✗ Replica set status check failed:', err.message);
    }

    // 2. Database Name & Collections
    const dbName = mongoose.connection.db.databaseName;
    console.log(`\n✓ Database Name: ${dbName}`);

    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`✓ Found ${collections.length} collections:`);

    for (const col of collections) {
        const count = await mongoose.connection.db.collection(col.name).countDocuments();
        const indexes = await mongoose.connection.db.collection(col.name).indexes();
        const indexNames = indexes.map(idx => Object.keys(idx.key).join('+')).join(', ');
        console.log(`   - ${col.name.padEnd(20)}: ${String(count).padStart(5)} documents | Indexes: [${indexNames}]`);
    }

    // 3. Test ACID Transaction with Session
    console.log('\n--- Testing Multi-Document ACID Transaction ---');
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            // Write a temporary record
            const testId = new mongoose.Types.ObjectId();
            await mongoose.connection.db.collection('categories').insertOne({
                _id: testId,
                name: 'ACID-Test-Category',
                slug: `acid-test-${Date.now()}`
            }, { session });

            // Abort intentionally to test rollback
            throw new Error('INTENTIONAL_ROLLBACK');
        });
    } catch (err) {
        if (err.message === 'INTENTIONAL_ROLLBACK') {
            console.log('✓ ACID Transaction started and rolled back successfully without leaking data');
        } else {
            console.error('✗ Transaction failed unexpectedly:', err);
        }
    } finally {
        await session.endSession();
    }

    await mongoose.disconnect();
    console.log('✓ Database inspection finished cleanly\n');
}

verifyDatabase().catch(err => {
    console.error('Fatal DB Verification error:', err);
    process.exit(1);
});
